import ExpoModulesCore
import AVFoundation
import Accelerate

private let kBlockMs: Double       = 0.1
private let kMinThresholdDB: Float = -40.0
private let kOffsetDB: Float       =  8.0
private let kEmaAlpha: Float       = 0.01
private let kCalibrationBlocks     = 300   // 300 × 100ms = 30초

// 시뮬레이터·실기기 모두 안정적으로 동작하는 표준 포맷
private let kTapSampleRate: Double = 44100
private let kTapChannels: AVAudioChannelCount = 1

public class BruxismModule: Module {

  private var audioEngine:  AVAudioEngine?
  private var isCapturing = false
  private var accumulator:  [Float] = []
  private var blockSamples  = Int(kTapSampleRate * kBlockMs)  // 4410
  private var bgNoiseRMS:   Float = 0.001
  private var blockCount    = 0

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
      // 권한 팝업을 띄우고 결과를 동기적으로 기다림
      let sem = DispatchSemaphore(value: 0)
      var allowed = false
      session.requestRecordPermission { granted in
        allowed = granted
        sem.signal()
      }
      sem.wait()
      guard allowed else {
        throw NSError(domain: "BruxismModule", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "마이크 권한이 필요합니다"])
      }
    case .denied:
      throw NSError(domain: "BruxismModule", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "설정에서 마이크 권한을 허용해 주세요"])
    default:
      break
    }

    try startAudioEngine()
  }

  // MARK: - AVAudioEngine 시작
  private func startAudioEngine() throws {
    guard !isCapturing else { return }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord,
                            mode: .measurement,
                            options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let engine    = AVAudioEngine()
    let inputNode = engine.inputNode

    // 하드웨어 실제 포맷을 그대로 사용 — 포맷 강제 지정 시 시뮬레이터에서 크래시 발생
    let tapFormat = inputNode.inputFormat(forBus: 0)
    let actualRate = tapFormat.sampleRate > 0 ? tapFormat.sampleRate : kTapSampleRate
    blockSamples = Int(actualRate * kBlockMs)

    inputNode.installTap(
      onBus: 0,
      bufferSize: AVAudioFrameCount(blockSamples),
      format: tapFormat
    ) { [weak self] buffer, _ in
      self?.handleBuffer(buffer)
    }

    try engine.start()

    audioEngine = engine
    isCapturing = true
    accumulator = []
    bgNoiseRMS  = 0.001
    blockCount  = 0

    sendEvent("onDebug", ["msg": "엔진 시작 완료. 포맷: \(tapFormat.sampleRate)Hz \(tapFormat.channelCount)ch"])
  }

  // MARK: - 엔진 중지
  private func stopAudioEngine() {
    guard isCapturing else { return }
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    isCapturing = false
    accumulator = []
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  // MARK: - 버퍼 수신
  private func handleBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData else {
      sendEvent("onDebug", ["msg": "floatChannelData nil — 포맷 불일치"])
      return
    }
    let frames = Int(buffer.frameLength)
    let samples = Array(UnsafeBufferPointer(start: data[0], count: frames))

    accumulator.append(contentsOf: samples)
    while accumulator.count >= blockSamples {
      let block = Array(accumulator.prefix(blockSamples))
      accumulator.removeFirst(blockSamples)
      processBlock(block)
    }
  }

  // MARK: - Stage 1: RMS → dBFS → EMA → 임계값 비교
  private func processBlock(_ samples: [Float]) {
    let rms   = computeRMS(samples)
    let dBFS  = rmsToDBFS(rms)
    blockCount += 1

    let isCalibrating    = blockCount <= kCalibrationBlocks
    let calibSecondsLeft = max(0, kCalibrationBlocks - blockCount) / 10
    let threshold        = computeThreshold()
    let stage1Pass       = !isCalibrating && dBFS >= threshold

    if isCalibrating || !stage1Pass {
      bgNoiseRMS = kEmaAlpha * rms + (1.0 - kEmaAlpha) * bgNoiseRMS
    }

    sendEvent("onAudioUpdate", [
      "dBFS":             dBFS,
      "threshold":        isCalibrating ? kMinThresholdDB : threshold,
      "stage1Pass":       stage1Pass,
      "isCalibrating":    isCalibrating,
      "calibSecondsLeft": calibSecondsLeft
    ])
  }

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
