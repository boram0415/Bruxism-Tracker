import ExpoModulesCore
import AVFoundation
import Accelerate

// MARK: - 상수
private let kBlockMs: Double        = 0.05   // 50ms — 0.1s 이갈이 캡처를 위해 절반 축소
private let kMinThresholdDB: Float  = -40.0
private let kOffsetDB: Float        =  8.0
private let kEmaAlpha: Float        = 0.01
private let kCalibrationBlocks      = 600    // 600 × 50ms = 30초
private let kMinDurationFFT         = 2      // FFT 확정 시:  2 × 50ms = 100ms 이상
private let kMinDurationNoFFT       = 10     // FFT 미확정 시: 10 × 50ms = 500ms 이상
private let kMaxDurationBlocks      = 60     // 60 × 50ms = 3.0초 초과 시 리셋
private let kFFTBruxismRatio: Float = 0.30   // 1–4 kHz 에너지 비율 ≥ 30% → 이갈이 주파수 확정

private let kTapSampleRate: Double  = 44100

// MARK: - DurationValidator 상태머신
private enum DetectionState {
  case idle
  case candidate(blocksAbove: Int, fftConfirmed: Bool)
  case confirmed(blocksTotal: Int)
}

// MARK: - Module
public class BruxismModule: Module {

  private var audioEngine:      AVAudioEngine?
  private var isCapturing       = false
  private var accumulator:      [Float] = []
  private var blockSamples      = Int(kTapSampleRate * kBlockMs)
  private var bgNoiseRMS:       Float = 0.001
  private var blockCount        = 0
  private var detectionState    = DetectionState.idle

  private var fftSetup:         FFTSetup?
  private var fftLog2n:         vDSP_Length = 0
  private var fftSize:          Int = 0
  private var actualSampleRate: Float = Float(kTapSampleRate)

  public func definition() -> ModuleDefinition {
    Name("BruxismModule")
    Events("onAudioUpdate", "onDebug")

    AsyncFunction("startCapture") { [weak self] () throws in
      try self?.requestPermissionAndStart()
    }

    Function("stopCapture") { [weak self] in
      self?.stopAudioEngine()
    }
  }

  // MARK: - 권한 요청 후 엔진 시작
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

    actualSampleRate = Float(rate)
    blockSamples     = Int(rate * kBlockMs)
    setupFFT(blockSamples: blockSamples)

    inputNode.installTap(onBus: 0,
                         bufferSize: AVAudioFrameCount(blockSamples),
                         format: tapFormat) { [weak self] buffer, _ in
      self?.handleBuffer(buffer)
    }

    try engine.start()

    audioEngine    = engine
    isCapturing    = true
    accumulator    = []
    bgNoiseRMS     = 0.001
    blockCount     = 0
    detectionState = .idle

    sendEvent("onDebug", ["msg": "엔진 시작. \(rate)Hz / 블록 \(blockSamples) 샘플 / FFT \(fftSize)pt"])
  }

  // MARK: - 엔진 중지
  private func stopAudioEngine() {
    guard isCapturing else { return }
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    isCapturing  = false
    accumulator  = []
    if let s = fftSetup { vDSP_destroy_fftsetup(s); fftSetup = nil }
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  // MARK: - 버퍼 수신
  private func handleBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData else {
      sendEvent("onDebug", ["msg": "floatChannelData nil — 포맷 불일치"])
      return
    }
    let frames  = Int(buffer.frameLength)
    let samples = Array(UnsafeBufferPointer(start: data[0], count: frames))
    accumulator.append(contentsOf: samples)
    while accumulator.count >= blockSamples {
      let block = Array(accumulator.prefix(blockSamples))
      accumulator.removeFirst(blockSamples)
      processBlock(block)
    }
  }

  // MARK: - FFT 셋업 (엔진 시작 시 1회)
  private func setupFFT(blockSamples: Int) {
    if let old = fftSetup { vDSP_destroy_fftsetup(old) }
    var log2n: vDSP_Length = 0
    var sz = 1
    while sz * 2 <= blockSamples { sz *= 2; log2n += 1 }
    fftLog2n = log2n
    fftSize  = sz
    fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))
  }

  // MARK: - Stage 1 (진폭) + Stage 2 (FFT + DurationValidator)
  private func processBlock(_ samples: [Float]) {
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

  // MARK: - FFT: 1–4 kHz 에너지 비율 계산
  private func computeBruxismRatio(_ samples: [Float]) -> Float {
    guard let setup = fftSetup, fftSize >= 4 else { return 0 }
    let n    = fftSize
    let half = n / 2

    // Hann 윈도우
    var windowed = Array(samples.prefix(n))
    if windowed.count < n { windowed += [Float](repeating: 0, count: n - windowed.count) }
    var window = [Float](repeating: 0, count: n)
    vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
    vDSP_vmul(windowed, 1, window, 1, &windowed, 1, vDSP_Length(n))

    // 실수 신호 → split-complex 패킹
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

    // FFT 실행 → 파워 스펙트럼 → 이갈이 대역 비율
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
        let lo       = max(0, Int((1000 / binWidth).rounded()))
        let hi       = min(half - 1, Int((4000 / binWidth).rounded()))
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
