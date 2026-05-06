# Bruxism App — 작업 체크리스트

- [x] 1단계: Expo 프로젝트 생성 및 expo-av 설치 완료
- [x] 2단계: Supabase 연동 및 로그인/회원가입 (Auth) 뼈대 구축
- [x] 3단계: Home 화면 (마이크 권한 연동, 수면 시작 버튼, 데시벨 감지 및 타임스탬프 로컬 저장 로직) 구현
- [x] 4단계: Report 화면 (밤사이 감지된 이갈이 횟수 확인) 및 Tips 화면 구현
- [x] 5단계: 이갈이 구간 30초 세그먼트 클립 저장 + Report 재생 버튼 + MyPage(슬라이더·로그아웃) 구현
- [x] 6단계: 분석 리포트 시각화 — 요약 카드 3종(총 감지·평균 소음·가장 활발한 시간대) + 시간대별 막대그래프 + 테스트 데이터 버튼
- [x] 7단계: 개인화 패턴 학습 — 초기 임계값 -40dBFS(스펀지 모드), 리포트 ✅/❌ 피드백 버튼, 3개 누적 시 threshold 자동 캘리브레이션, MyPage 슬라이더 → 학습 상태 UI로 개편

## V2 — Native DSP Module (iOS)

- [x] V2-1: expo prebuild (Bare Workflow 전환, ios/ 폴더 생성, Background Audio 모드 추가)
- [x] V2-2: Expo Native Module 뼈대 — modules/bruxism-audio/ (Swift + TS 타입 정의)
- [x] V2-3: AVAudioEngine PCM 캡처 + accumulator 패턴 (100ms 블록 정확 처리)
- [x] V2-4: Stage 1 — EMA 동적 임계값 (배경소음 자동 추정, 30초 캘리브레이션)
- [x] V2-5: Home.tsx 연동 — expo-av 완전 제거, BruxismModule 이벤트 리스너로 교체
- [ ] V2-6: Stage 2 — FFT 주파수 분석 (Accelerate.framework, 1-4kHz 비율 검증)
- [ ] V2-7: RingBuffer — 이벤트 전후 2-3초 오디오 캡처 및 클립 저장
- [ ] V2-8: DurationValidator — 0.5s~3.0s 지속시간 검증 상태머신
- [ ] V2-9: Android Native Module (Kotlin + AudioRecord, 기기 확보 후 진행)
