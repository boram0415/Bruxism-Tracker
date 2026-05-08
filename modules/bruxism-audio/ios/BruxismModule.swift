import ExpoModulesCore
import AVFoundation
import Accelerate

// MARK: - 상수
private let kBlockMs: Double        = 0.05
private let kMinThresholdDB: Float  = -40.0
private let kOffsetDB: Float        =  8.0
private let kEmaAlpha: Float        = 0.01
private let kCalibrationBlocks      = 600
private let kMinDurationFFT         = 2
private let kMinDurationNoFFT       = 10
private let kMaxDurationBlocks      = 60
private let kFFTBruxismRatio: Float = 0.30
private let kPreEventSeconds        = 2.0   // 클립 이벤트 앞 2초
private let kPostEventSeconds       = 1.0   // 클립 이벤트 뒤 1초

private let kTapSampleRate: Double  = 44100

private enum DetectionState {
  case idle
  case candidate(blocksAbove: Int, fftConfirmed: Bool)
  case confirmed(blocksTotal: Int)
}

public class BruxismModule: Module {

  private var audioEngine:       AVAudioEngine?
  private var isCapturing        = false
  private var accumulator:       [Float] = []
  private var blockSamples       = Int(kTapSampleRate * kBlockMs)
  private var bgNoiseRMS:        Float = 0.001
  private var blockCount         = 0
  private var detectionState     = DetectionState.idle
  private var actualSampleRate:  Float = Float(kTapSampleRate)

  // FFT
  private var fftSetup:          FFTSetup?
  private var fftLog2n:          vDSP_Length = 0
  private var fftSize:           Int = 0

  // RingBuffer: 이갈이 이전 오디오를 kPreEventSeconds 동안 보관
  private var ringBuffer:        [Float] = []
  private var ringBufferMax      = 0

  // Post-event 수집: 이갈이 확정 후 kPostEventSeconds 동안 추가 녹음
  private var preEventSnapshot:  [Float] = []
  private var postEventSamples:  [Float] = []
  private var postEventTarget    = 0
  private var isCollectingPost   = false

  public func definition() -> ModuleDefinition {
    Name("BruxismModule")
    Events("onAudioUpdate", "onDebug", "onClipSaved")

    AsyncFunction("startCapture") { [weak self] () throws in
      try self?.requestPermissionAndStart()
    }

    Function("stopCapture") { [weak self] in
      self?.stopAudioEngine()
    }
  }

  // MARK: - 권한 + 시작
  private func requestPermissionAndStart() throws {
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .undetermined:
      let sem = DispatchSemaphore(value: 0)
      var allowed = false
      session.requestRecordPermission { granted in allowed = granted; sem.signal() }
      sem.wait()
      guard allowed else {
        throw NSError(domain: "BruxismModule", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "마이크 권한이 필요합니다"])
      }
    case .denied:
      throw NSError(domain: "BruxismModule", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "설정에서 마이크 권한을 허용해 주세요"])
    default: break
    }
    try startAudioEngine()
  }

  // MARK: - AVAudioEngine 시작
  private func startAudioEngine() throws {
    guard !isCapturing else { return }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement,
                            options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let engine    = AVAudioEngine()
    let inputNode = engine.inputNode
    let tapFormat = inputNode.inputFormat(forBus: 0)
    let rate      = tapFormat.sampleRate > 0 ? tapFormat.sampleRate : kTapSampleRate

    actualSampleRate  = Float(rate)
    blockSamples      = Int(rate * kBlockMs)
    ringBufferMax     = Int(rate * kPreEventSeconds) + blockSamples * 2
    postEventTarget   = Int(rate * kPostEventSeconds)
    setupFFT(blockSamples: blockSamples)

    inputNode.installTap(onBus: 0,
                         bufferSize: AVAudioFrameCount(blockSamples),
                         format: tapFormat) { [weak self] buffer, _ in
      self?.handleBuffer(buffer)
    }

    try engine.start()

    audioEngine       = engine
    isCapturing       = true
    accumulator       = []
    ringBuffer        = []
    bgNoiseRMS        = 0.001
    blockCount        = 0
    detectionState    = .idle
    isCollectingPost  = false
    preEventSnapshot  = []
    postEventSamples  = []

    sendEvent("onDebug", ["msg": "엔진 시작. \(rate)Hz / 블록 \(blockSamples)샘플"])
  }

  // MARK: - 엔진 중지
  private func stopAudioEngine() {
    guard isCapturing else { return }
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    isCapturing  = false
    accumulator  = []
    ringBuffer   = []
    if let s = fftSetup { vDSP_destroy_fftsetup(s); fftSetup = nil }
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  // MARK: - 버퍼 수신
  private func handleBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData else { return }
    let frames  = Int(buffer.frameLength)
    let samples = Array(UnsafeBufferPointer(start: data[0], count: frames))
    accumulator.append(contentsOf: samples)
    while accumulator.count >= blockSamples {
      let block = Array(accumulator.prefix(blockSamples))
      accumulator.removeFirst(blockSamples)
      processBlock(block)
    }
  }

  // MARK: - FFT 셋업
  private func setupFFT(blockSamples: Int) {
    if let old = fftSetup { vDSP_destroy_fftsetup(old) }
    var log2n: vDSP_Length = 0
    var sz = 1
    while sz * 2 <= blockSamples { sz *= 2; log2n += 1 }
    fftLog2n = log2n
    fftSize  = sz
    fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))
  }

  // MARK: - 블록 처리
  private func processBlock(_ samples: [Float]) {
    // RingBuffer 갱신
    ringBuffer.append(contentsOf: samples)
    if ringBuffer.count > ringBufferMax {
      ringBuffer.removeFirst(ringBuffer.count - ringBufferMax)
    }

    // Post-event 수집 중이면 추가
    if isCollectingPost {
      postEventSamples.append(contentsOf: samples)
      if postEventSamples.count >= postEventTarget {
        isCollectingPost = false
        let pre  = preEventSnapshot
        let post = Array(postEventSamples.prefix(postEventTarget))
        preEventSnapshot = []
        postEventSamples = []
        saveClip(pre: pre, post: post)
      }
    }

    // Stage 1
    let rms  = computeRMS(samples)
    let dBFS = rmsToDBFS(rms)
    blockCount += 1

    let isCalibrating    = blockCount <= kCalibrationBlocks
    let calibSecondsLeft = max(0, kCalibrationBlocks - blockCount) / 20
    let threshold        = computeThreshold()
    let stage1Pass       = !isCalibrating && dBFS >= threshold

    if isCalibrating || !stage1Pass {
      bgNoiseRMS = kEmaAlpha * rms + (1.0 - kEmaAlpha) * bgNoiseRMS
    }

    // Stage 2: FFT + DurationValidator
    var durationPass = false
    if !isCalibrating {
      switch detectionState {
      case .idle:
        if stage1Pass {
          let fftOK = computeBruxismRatio(samples) >= kFFTBruxismRatio
          detectionState = .candidate(blocksAbove: 1, fftConfirmed: fftOK)
        }

      case .candidate(let n, let fftOK):
        if stage1Pass {
          let newFftOK  = fftOK || (computeBruxismRatio(samples) >= kFFTBruxismRatio)
          let next      = n + 1
          let minBlocks = newFftOK ? kMinDurationFFT : kMinDurationNoFFT
          if next >= minBlocks {
            detectionState = .confirmed(blocksTotal: next)
            durationPass   = true
            startPostEventCapture()
          } else if next >= kMaxDurationBlocks {
            detectionState = .idle
          } else {
            detectionState = .candidate(blocksAbove: next, fftConfirmed: newFftOK)
          }
        } else {
          detectionState = .idle
        }

      case .confirmed(let n):
        if stage1Pass {
          let next = n + 1
          detectionState = next >= kMaxDurationBlocks ? .idle : .confirmed(blocksTotal: next)
        } else {
          detectionState = .idle
        }
      }
    }

    sendEvent("onAudioUpdate", [
      "dBFS":             dBFS,
      "threshold":        isCalibrating ? kMinThresholdDB : threshold,
      "stage1Pass":       stage1Pass,
      "durationPass":     durationPass,
      "isCalibrating":    isCalibrating,
      "calibSecondsLeft": calibSecondsLeft
    ])
  }

  // MARK: - Post-event 수집 시작
  private func startPostEventCapture() {
    guard !isCollectingPost else { return }
    let preSamples   = Int(actualSampleRate * Float(kPreEventSeconds))
    preEventSnapshot = Array(ringBuffer.suffix(min(preSamples, ringBuffer.count)))
    postEventSamples = []
    isCollectingPost = true
  }

  // MARK: - 클립 저장 (백그라운드)
  private func saveClip(pre: [Float], post: [Float]) {
    let samples  = pre + post
    let filename = "bruxism_\(Int(Date().timeIntervalSince1970)).wav"
    guard let docDir = FileManager.default.urls(for: .documentDirectory,
                                                in: .userDomainMask).first else { return }
    let url = docDir.appendingPathComponent(filename)

    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self else { return }
      do {
        try self.writeWAV(samples: samples, sampleRate: self.actualSampleRate, to: url)
        self.sendEvent("onClipSaved", ["path": url.path])
      } catch {
        self.sendEvent("onDebug", ["msg": "클립 저장 실패: \(error)"])
      }
    }
  }

  // MARK: - WAV 파일 쓰기 (Float → Int16 PCM)
  private func writeWAV(samples: [Float], sampleRate: Float, to url: URL) throws {
    let dataBytes = samples.count * 2
    var wav = Data(capacity: 44 + dataBytes)

    func le<T: FixedWidthInteger>(_ v: T) -> [UInt8] {
      withUnsafeBytes(of: v.littleEndian) { Array($0) }
    }

    wav.append(contentsOf: [UInt8]("RIFF".utf8))
    wav.append(contentsOf: le(UInt32(36 + dataBytes)))
    wav.append(contentsOf: [UInt8]("WAVE".utf8))
    wav.append(contentsOf: [UInt8]("fmt ".utf8))
    wav.append(contentsOf: le(UInt32(16)))
    wav.append(contentsOf: le(UInt16(1)))                    // PCM
    wav.append(contentsOf: le(UInt16(1)))                    // mono
    wav.append(contentsOf: le(UInt32(sampleRate)))
    wav.append(contentsOf: le(UInt32(sampleRate) * 2))       // byteRate
    wav.append(contentsOf: le(UInt16(2)))                    // blockAlign
    wav.append(contentsOf: le(UInt16(16)))                   // bitsPerSample
    wav.append(contentsOf: [UInt8]("data".utf8))
    wav.append(contentsOf: le(UInt32(dataBytes)))

    for s in samples {
      let i16 = Int16(max(-32767, min(32767, Int32(s * 32767))))
      wav.append(contentsOf: le(i16))
    }

    try wav.write(to: url)
  }

  // MARK: - FFT: 1–4 kHz 에너지 비율
  private func computeBruxismRatio(_ samples: [Float]) -> Float {
    guard let setup = fftSetup, fftSize >= 4 else { return 0 }
    let n    = fftSize
    let half = n / 2

    var windowed = Array(samples.prefix(n))
    if windowed.count < n { windowed += [Float](repeating: 0, count: n - windowed.count) }
    var window = [Float](repeating: 0, count: n)
    vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
    vDSP_vmul(windowed, 1, window, 1, &windowed, 1, vDSP_Length(n))

    var realBuf = [Float](repeating: 0, count: half)
    var imagBuf = [Float](repeating: 0, count: half)
    windowed.withUnsafeBufferPointer { wp in
      wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { cp in
        realBuf.withUnsafeMutableBufferPointer { rp in
          imagBuf.withUnsafeMutableBufferPointer { ip in
            var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
            vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(half))
          }
        }
      }
    }

    var result: Float = 0
    realBuf.withUnsafeMutableBufferPointer { rp in
      imagBuf.withUnsafeMutableBufferPointer { ip in
        var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        vDSP_fft_zrip(setup, &split, 1, fftLog2n, FFTDirection(kFFTDirection_Forward))

        var mags = [Float](repeating: 0, count: half)
        vDSP_zvmags(&split, 1, &mags, 1, vDSP_Length(half))

        var total: Float = 0
        vDSP_sve(mags, 1, &total, vDSP_Length(half))
        guard total > 1e-10 else { return }

        let binWidth = actualSampleRate / Float(n)
        let lo = max(0, Int((1000 / binWidth).rounded()))
        let hi = min(half - 1, Int((4000 / binWidth).rounded()))
        guard lo <= hi else { return }

        var bruxism: Float = 0
        let slice = Array(mags[lo...hi])
        vDSP_sve(slice, 1, &bruxism, vDSP_Length(slice.count))
        result = bruxism / total
      }
    }
    return result
  }

  // MARK: - 유틸
  private func computeRMS(_ s: [Float]) -> Float {
    var r: Float = 0
    vDSP_rmsqv(s, 1, &r, vDSP_Length(s.count))
    return max(r, 1e-10)
  }

  private func rmsToDBFS(_ rms: Float) -> Float { 20.0 * log10(rms) }

  private func computeThreshold() -> Float {
    max(kMinThresholdDB, rmsToDBFS(bgNoiseRMS) + kOffsetDB)
  }
}
