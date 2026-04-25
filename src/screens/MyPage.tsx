import React, { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { THRESHOLD_KEY } from './Home';

const STORAGE_KEY      = 'bruxism_events';
const MIN_SAMPLES      = 3;

type BruxismEvent = { timestamp: string; db: number; clipUri?: string; feedback?: 'confirmed' | 'rejected' };

export default function MyPage() {
  const [email, setEmail]                       = useState('');
  const [confirmedCount, setConfirmedCount]     = useState(0);
  const [calibratedDb, setCalibratedDb]         = useState<number | null>(null);

  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '');
    });

    AsyncStorage.getItem(STORAGE_KEY).then(async raw => {
      const events: BruxismEvent[] = raw ? JSON.parse(raw) : [];
      const confirmedDbs = events
        .filter(e => e.feedback === 'confirmed')
        .map(e => e.db);

      setConfirmedCount(confirmedDbs.length);

      if (confirmedDbs.length >= MIN_SAMPLES) {
        const avg = Math.round(confirmedDbs.reduce((a, b) => a + b, 0) / confirmedDbs.length);
        setCalibratedDb(avg);
        await AsyncStorage.setItem(THRESHOLD_KEY, String(avg));
      } else {
        setCalibratedDb(null);
      }
    });
  }, []));

  async function handleLogout() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.auth.signOut();
          if (error) Alert.alert('오류', error.message);
        },
      },
    ]);
  }

  const isCalibrated = calibratedDb !== null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>마이페이지</Text>

      {/* 계정 */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>계정</Text>
        <View style={styles.card}>
          <Text style={styles.cardKey}>이메일</Text>
          <Text style={styles.cardValue} numberOfLines={1}>{email || '로딩 중...'}</Text>
        </View>
      </View>

      {/* 패턴 학습 */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>나의 이갈이 패턴</Text>
        <View style={[styles.card, styles.calibrationCard]}>
          {isCalibrated ? (
            <>
              <View style={styles.calibrationBadge}>
                <Text style={styles.calibrationBadgeText}>맞춤 설정 완료</Text>
              </View>
              <Text style={styles.calibrationTitle}>당신의 감지 기준</Text>
              <Text style={styles.calibrationValue}>{calibratedDb} dBFS</Text>
              <Text style={styles.calibrationMeta}>
                총 {confirmedCount}개 샘플 기반 · 피드백이 쌓일수록 자동 업데이트됩니다
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.calibrationTitle}>패턴 분석 중...</Text>
              <View style={styles.dotsRow}>
                {[0, 1, 2].map(i => (
                  <View
                    key={i}
                    style={[styles.dot, i < confirmedCount && styles.dotFilled]}
                  />
                ))}
              </View>
              <Text style={styles.calibrationProgress}>
                {confirmedCount}/{MIN_SAMPLES}개 수집됨
              </Text>
              <Text style={styles.calibrationHint}>
                리포트 화면에서 녹음 클립을 듣고{'\n'}
                "이갈이 맞음 ✅"을 눌러주세요.{'\n'}
                {MIN_SAMPLES}개가 모이면 맞춤 기준이 자동 설정됩니다.
              </Text>
            </>
          )}
        </View>
      </View>

      {/* 로그아웃 */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>로그아웃</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f8f9fa' },
  content:    { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 },
  title:      { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 28 },
  section:    { marginBottom: 24 },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: '#aaa',
    letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardKey:   { fontSize: 13, color: '#888', marginBottom: 4 },
  cardValue: { fontSize: 15, color: '#1a1a2e', fontWeight: '500' },

  calibrationCard:       { paddingVertical: 24, alignItems: 'center' },
  calibrationBadge: {
    backgroundColor: '#d1fae5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 14,
  },
  calibrationBadgeText:  { fontSize: 12, color: '#065f46', fontWeight: '600' },
  calibrationTitle:      { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 10 },
  calibrationValue:      { fontSize: 40, fontWeight: '800', color: '#4f46e5', marginBottom: 8 },
  calibrationMeta:       { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18 },

  dotsRow:       { flexDirection: 'row', gap: 10, marginBottom: 10 },
  dot:           { width: 14, height: 14, borderRadius: 7, backgroundColor: '#e0e0e0' },
  dotFilled:     { backgroundColor: '#4f46e5' },
  calibrationProgress: { fontSize: 13, color: '#4f46e5', fontWeight: '700', marginBottom: 14 },
  calibrationHint:     { fontSize: 13, color: '#aaa', textAlign: 'center', lineHeight: 20 },

  logoutButton: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e53e3e',
    alignItems: 'center',
  },
  logoutText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
});
