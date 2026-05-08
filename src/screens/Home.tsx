import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import BruxismModule from '../../modules/bruxism-audio';
import type { AudioUpdatePayload } from '../../modules/bruxism-audio';

const STORAGE_KEY   = 'bruxism_events';
const WAVEFORM_BARS = 8;

export const THRESHOLD_KEY     = 'bruxism_threshold';
export const DEFAULT_THRESHOLD = -40;

type AnalysisPhase = 'idle' | 'detecting' | 'stage1_pass' | 'confirmed';

export default function Home() {
  const [isRecording, setIsRecording]         = useState(false);
  const [currentDb, setCurrentDb]             = useState<number | null>(null);
  const [analysisPhase, setAnalysisPhase]     = useState<AnalysisPhase>('idle');
  const [isCalibrating, setIsCalibrating]       = useState(false);
  const [calibSecondsLeft, setCalibSecondsLeft] = useState(30);
  const [threshold, setThreshold]               = useState<number | null>(null);

  const isActiveRef = useRef(false);
  const isSavingRef = useRef(false);

  const barMultipliers = useRef(
    Array.from({ length: WAVEFORM_BARS }, () => 0.35 + Math.random() * 0.65)
  ).current;
  const barAnims = useRef(
    Array.from({ length: WAVEFORM_BARS }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    if (!isRecording || currentDb === null) {
      Animated.parallel(
        barAnims.map(a => Animated.spring(a, { toValue: 0, useNativeDriver: false }))
      ).start();
      return;
    }
    const normalized = Math.max(0, Math.min(1, (currentDb + 60) / 60));
    barAnims.forEach((anim, i) => {
      Animated.spring(anim, {
        toValue: normalized * barMultipliers[i],
        useNativeDriver: false,
        tension: 50,
        friction: 6,
      }).start();
    });
  }, [currentDb, isRecording, barAnims, barMultipliers]);

  useEffect(() => {
    const debugSub = BruxismModule.addListener('onDebug', ({ msg }) => {
      console.log('[BruxismModule]', msg);
    });
    return () => debugSub.remove();
  }, []);

  useEffect(() => {
    const subscription = BruxismModule.addListener(
      'onAudioUpdate',
      (payload: AudioUpdatePayload) => {
        if (!isActiveRef.current) return;

        setCurrentDb(payload.dBFS);
        setThreshold(payload.threshold);
        setIsCalibrating(payload.isCalibrating);
        setCalibSecondsLeft(payload.calibSecondsLeft);

        if (payload.isCalibrating) {
          setAnalysisPhase('detecting');
          return;
        }

        if (payload.durationPass) {
          setAnalysisPhase('confirmed');
          saveEventIfNeeded(payload.dBFS);
        } else if (payload.stage1Pass) {
          setAnalysisPhase('stage1_pass');
        } else {
          setAnalysisPhase('detecting');
        }
      }
    );
    return () => subscription.remove();
  }, []);

  const saveEventIfNeeded = useCallback(async (db: number) => {
    if (isSavingRef.current || !isActiveRef.current) return;
    isSavingRef.current = true;
    try {
      const event = { timestamp: new Date().toISOString(), db, clipPath: '' };
      const raw    = await AsyncStorage.getItem(STORAGE_KEY);
      const events = raw ? JSON.parse(raw) : [];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...events, event]));
      setAnalysisPhase('confirmed');
      setTimeout(() => { if (isActiveRef.current) setAnalysisPhase('detecting'); }, 600);
    } catch (e) {
      console.error('이벤트 저장 실패:', e);
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  // 클립 저장 완료 시 마지막 이벤트에 경로 반영
  useEffect(() => {
    const sub = BruxismModule.addListener('onClipSaved', async ({ path }) => {
      try {
        const raw    = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const events = JSON.parse(raw);
        if (events.length === 0) return;
        events[events.length - 1].clipPath = path;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events));
      } catch (e) {
        console.error('클립 경로 저장 실패:', e);
      }
    });
    return () => sub.remove();
  }, []);

  async function startRecording() {
    try {
      isActiveRef.current = true;
      setIsRecording(true);
      setAnalysisPhase('detecting');
      setCalibSecondsLeft(30);
      await BruxismModule.startCapture();
    } catch (e) {
      Alert.alert('오류', '마이크 접근에 실패했습니다. 설정에서 권한을 허용해 주세요.');
      isActiveRef.current = false;
      setIsRecording(false);
      setAnalysisPhase('idle');
    }
  }

  function stopRecording() {
    isActiveRef.current = false;
    BruxismModule.stopCapture();
    setIsRecording(false);
    setCurrentDb(null);
    setAnalysisPhase('idle');
    setIsCalibrating(false);
  }

  const phaseColor = analysisPhase === 'confirmed' ? '#e53e3e' : '#4f46e5';

  const phaseLabel = (() => {
    if (!isRecording) return '';
    if (isCalibrating) return `배경소음 측정 중... ${calibSecondsLeft}초 남음`;
    if (analysisPhase === 'stage1_pass') return 'Stage 1 통과 — 후보 이벤트';
    if (analysisPhase === 'confirmed') return '이갈이 의심 감지!';
    return '소리 감지 중...';
  })();

  return (
    <View style={[styles.container, isRecording && styles.containerDark]}>
      <Text style={[styles.statusText, isRecording && styles.textLight]}>
        {isRecording ? '수면 감지 중...' : '수면 준비'}
      </Text>

      {isRecording && (
        <View style={styles.waveform}>
          {barAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: anim.interpolate({ inputRange: [0, 1], outputRange: [4, 52] }),
                  backgroundColor: phaseColor,
                },
              ]}
            />
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, isRecording ? styles.buttonStop : styles.buttonStart]}
        onPress={isRecording ? stopRecording : startRecording}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {isRecording ? '수면 종료' : '수면 시작'}
        </Text>
      </TouchableOpacity>

      {isRecording && (
        <View style={styles.infoBox}>
          {currentDb !== null && (
            <Text style={styles.dbText}>현재 소음: {currentDb.toFixed(1)} dBFS</Text>
          )}
          {threshold !== null && (
            <Text style={styles.dbText}>임계값: {threshold.toFixed(1)} dBFS</Text>
          )}
          {phaseLabel !== '' && (
            <Text style={[styles.phaseText, { color: phaseColor }]}>{phaseLabel}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f8f9fa', alignItems: 'center', justifyContent: 'center', gap: 28 },
  containerDark: { backgroundColor: '#0d0d1a' },
  statusText:    { fontSize: 18, fontWeight: '600', color: '#333', letterSpacing: 0.5 },
  textLight:     { color: '#aaa' },
  waveform:      { flexDirection: 'row', alignItems: 'center', gap: 6, height: 56 },
  waveBar:       { width: 6, borderRadius: 3, opacity: 0.85 },
  button: {
    width: 200, height: 200, borderRadius: 100,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  buttonStart: { backgroundColor: '#4f46e5', shadowColor: '#4f46e5' },
  buttonStop:  { backgroundColor: '#e53e3e', shadowColor: '#e53e3e' },
  buttonText:  { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  infoBox:     { alignItems: 'center', gap: 6 },
  dbText:      { fontSize: 13, color: '#888', letterSpacing: 0.3 },
  phaseText:   { fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },
});
