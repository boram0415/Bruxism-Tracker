import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import type { RecordingStatus } from 'expo-av/build/Audio/Recording.types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';

const METERING_MS         = 500;
const REQUIRED_HITS       = 6;
const MAX_STD_DEV         = 8;
const STORAGE_KEY         = 'bruxism_events';
const SEGMENT_DURATION_MS = 30_000;
const WAVEFORM_BARS       = 8;

export const THRESHOLD_KEY      = 'bruxism_threshold';
export const DEFAULT_THRESHOLD  = -25;
export const CLIPS_DIR          = (FileSystem.documentDirectory ?? '') + 'clips/';

function stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}

type AnalysisPhase = 'idle' | 'detecting' | 'analyzing' | 'confirmed';

export default function Home() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording]     = useState(false);
  const [currentDb, setCurrentDb]         = useState<number | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('idle');
  const [hitCount, setHitCount]           = useState(0);

  const recordingRef       = useRef<Audio.Recording | null>(null);
  const segmentTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveHitsRef = useRef(0);
  const dbWindowRef        = useRef<number[]>([]);
  const thresholdRef       = useRef(DEFAULT_THRESHOLD);
  const isActiveRef        = useRef(false);
  const isSavingRef        = useRef(false);

  const barMultipliers = useRef(
    Array.from({ length: WAVEFORM_BARS }, () => 0.35 + Math.random() * 0.65)
  ).current;
  const barAnims = useRef(
    Array.from({ length: WAVEFORM_BARS }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status === 'granted') {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      }
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(THRESHOLD_KEY).then(val => {
      thresholdRef.current = val !== null ? Number(val) : DEFAULT_THRESHOLD;
    });
  }, []));

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

  const onStatusUpdate = useCallback(async (status: RecordingStatus) => {
    if (!status.isRecording || status.metering == null) return;
    const db = status.metering;
    setCurrentDb(db);

    if (db < thresholdRef.current) {
      consecutiveHitsRef.current = 0;
      dbWindowRef.current = [];
      setHitCount(0);
      setAnalysisPhase('detecting');
      return;
    }

    consecutiveHitsRef.current += 1;
    dbWindowRef.current = [...dbWindowRef.current, db].slice(-REQUIRED_HITS);
    setHitCount(consecutiveHitsRef.current);

    if (consecutiveHitsRef.current < REQUIRED_HITS) {
      setAnalysisPhase('analyzing');
      return;
    }

    const sd = stdDev(dbWindowRef.current);
    consecutiveHitsRef.current = 0;
    dbWindowRef.current = [];
    setHitCount(0);

    if (sd >= MAX_STD_DEV) {
      setAnalysisPhase('detecting');
      return;
    }

    await saveAndRestartRef.current(new Date().toISOString(), db);
  }, []);

  async function startNewSegment() {
    if (!isActiveRef.current) return;
    try {
      const { recording } = await Audio.Recording.createAsync(
        { ...Audio.RecordingOptionsPresets.LOW_QUALITY, isMeteringEnabled: true },
        onStatusUpdate,
        METERING_MS,
      );
      recordingRef.current = recording;
      segmentTimerRef.current = setTimeout(cycleSegment, SEGMENT_DURATION_MS);
    } catch (e) {
      console.error('세그먼트 시작 실패:', e);
    }
  }

  async function cycleSegment() {
    if (!isActiveRef.current) return;
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (e) {
        console.error('세그먼트 만료 처리 실패:', e);
      }
    }
    await startNewSegment();
  }

  const saveAndRestartRef = useRef(async (_ts: string, _db: number) => {});
  saveAndRestartRef.current = async (timestamp: string, db: number) => {
    if (isSavingRef.current || !isActiveRef.current) return;
    isSavingRef.current = true;

    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    const rec = recordingRef.current;
    recordingRef.current = null;
    let clipUri: string | undefined;

    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
        const tempUri = rec.getURI();
        if (tempUri) {
          await FileSystem.makeDirectoryAsync(CLIPS_DIR, { intermediates: true });
          clipUri = `${CLIPS_DIR}clip_${Date.now()}.m4a`;
          await FileSystem.copyAsync({ from: tempUri, to: clipUri });
        }
      } catch (e) {
        console.error('클립 파일 저장 실패:', e);
      }
    }

    try {
      const event: Record<string, unknown> = { timestamp, db };
      if (clipUri) event.clipUri = clipUri;
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const events = raw ? JSON.parse(raw) : [];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...events, event]));
    } catch (e) {
      console.error('이벤트 저장 실패:', e);
    }

    isSavingRef.current = false;
    setAnalysisPhase('confirmed');
    setTimeout(() => { if (isActiveRef.current) setAnalysisPhase('detecting'); }, 600);
    await startNewSegment();
  };

  async function startRecording() {
    if (!hasPermission) {
      Alert.alert('권한 오류', '마이크 권한이 필요합니다. 설정에서 허용해 주세요.');
      return;
    }
    isActiveRef.current = true;
    setIsRecording(true);
    setAnalysisPhase('detecting');
    await startNewSegment();
  }

  async function stopRecording() {
    isActiveRef.current = false;
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (_e) {}
    }
    consecutiveHitsRef.current = 0;
    dbWindowRef.current = [];
    setIsRecording(false);
    setCurrentDb(null);
    setAnalysisPhase('idle');
    setHitCount(0);
  }

  if (hasPermission === false) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>
          마이크 권한이 필요합니다.{'\n'}설정 앱에서 마이크 접근을 허용해 주세요.
        </Text>
      </View>
    );
  }

  const phaseColor = analysisPhase === 'confirmed' ? '#e53e3e' : '#4f46e5';
  const phaseLabel = {
    idle: '',
    detecting: '소리 감지 중...',
    analyzing: `주파수 분석 중... (${hitCount}/${REQUIRED_HITS})`,
    confirmed: '이갈이 의심 감지!',
  }[analysisPhase];

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
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permissionText: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 24 },
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
