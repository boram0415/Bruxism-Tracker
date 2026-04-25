import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { THRESHOLD_KEY, DEFAULT_THRESHOLD } from './Home';

const SLIDER_MIN   = -50;
const SLIDER_MAX   = -10;
const TRACK_WIDTH  = Dimensions.get('window').width - 64;

// ── 커스텀 슬라이더 (순수 JS, Expo Go 호환) ──────────────
function ThresholdSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const toX    = (v: number) => ((v - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * TRACK_WIDTH;
  const toValue = (x: number) =>
    Math.round(SLIDER_MIN + (x / TRACK_WIDTH) * (SLIDER_MAX - SLIDER_MIN));

  const thumbX    = useRef(new Animated.Value(toX(value))).current;
  const currentX  = useRef(toX(value));

  // 외부 value 변경 시 동기화
  useEffect(() => {
    const x = toX(value);
    thumbX.setValue(x);
    currentX.current = x;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // currentX.current는 항상 최신 위치를 가리킴
      },
      onPanResponderMove: (_, { dx }) => {
        const newX = Math.max(0, Math.min(TRACK_WIDTH, currentX.current + dx));
        thumbX.setValue(newX);
        onChange(toValue(newX));
      },
      onPanResponderRelease: (_, { dx }) => {
        currentX.current = Math.max(0, Math.min(TRACK_WIDTH, currentX.current + dx));
      },
    })
  ).current;

  const fillWidth = thumbX.interpolate({
    inputRange: [0, TRACK_WIDTH],
    outputRange: [0, TRACK_WIDTH],
    extrapolate: 'clamp',
  });

  const thumbTranslate = thumbX.interpolate({
    inputRange: [0, TRACK_WIDTH],
    outputRange: [-12, TRACK_WIDTH - 12],
    extrapolate: 'clamp',
  });

  return (
    <View style={sliderStyles.wrapper}>
      {/* 트랙 */}
      <View style={sliderStyles.track}>
        <Animated.View style={[sliderStyles.fill, { width: fillWidth }]} />
      </View>
      {/* 썸 */}
      <Animated.View
        style={[
          sliderStyles.thumb,
          { transform: [{ translateX: thumbTranslate }] },
        ]}
        {...pan.panHandlers}
      />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrapper: {
    height: 40,
    justifyContent: 'center',
    width: TRACK_WIDTH,
    alignSelf: 'center',
  },
  track: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    backgroundColor: '#4f46e5',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4f46e5',
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
});

// ── 메인 화면 ────────────────────────────────────────────
export default function MyPage() {
  const [email, setEmail]         = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  // 이메일 + threshold 로딩
  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '');
    });
    AsyncStorage.getItem(THRESHOLD_KEY).then(val => {
      setThreshold(val !== null ? Number(val) : DEFAULT_THRESHOLD);
    });
  }, []));

  // 슬라이더 값이 바뀔 때마다 AsyncStorage에 저장
  async function handleThresholdChange(v: number) {
    setThreshold(v);
    await AsyncStorage.setItem(THRESHOLD_KEY, String(v));
  }

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

  // 민감도 레이블 (낮음/보통/높음)
  const sensitivityLabel =
    threshold >= -20 ? '높음 (많이 잡힘)' :
    threshold >= -35 ? '보통' :
    '낮음 (잘 안 잡힘)';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>마이페이지</Text>

      {/* 계정 섹션 */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>계정</Text>
        <View style={styles.card}>
          <Text style={styles.cardKey}>이메일</Text>
          <Text style={styles.cardValue} numberOfLines={1}>{email || '로딩 중...'}</Text>
        </View>
      </View>

      {/* 민감도 설정 섹션 */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>감지 민감도 설정</Text>
        <View style={[styles.card, { paddingBottom: 20 }]}>
          <View style={styles.thresholdRow}>
            <Text style={styles.cardKey}>임계값</Text>
            <Text style={styles.thresholdValue}>{threshold} dBFS</Text>
            <Text style={styles.sensitivityBadge}>{sensitivityLabel}</Text>
          </View>

          <View style={{ marginTop: 16 }}>
            <ThresholdSlider value={threshold} onChange={handleThresholdChange} />
          </View>

          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabelLeft}>낮은 감도{'\n'}(잘 안 잡힘)</Text>
            <Text style={styles.sliderLabelRight}>높은 감도{'\n'}(많이 잡힘)</Text>
          </View>
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
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
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
  cardKey:          { fontSize: 13, color: '#888', marginBottom: 4 },
  cardValue:        { fontSize: 15, color: '#1a1a2e', fontWeight: '500' },
  thresholdRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thresholdValue:   { fontSize: 18, fontWeight: '700', color: '#4f46e5' },
  sensitivityBadge: { fontSize: 12, color: '#888', marginLeft: 'auto' as any },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  sliderLabelLeft:  { fontSize: 11, color: '#bbb', textAlign: 'left', lineHeight: 16 },
  sliderLabelRight: { fontSize: 11, color: '#bbb', textAlign: 'right', lineHeight: 16 },
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
