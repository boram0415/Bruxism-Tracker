import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { BarChart } from 'react-native-chart-kit';
import { CLIPS_DIR } from './Home';

const STORAGE_KEY  = 'bruxism_events';
const SCREEN_WIDTH = Dimensions.get('window').width;

const DUMMY_EVENTS = [
  { timestamp: new Date(Date.now() - 5 * 3600_000).toISOString(), db: -27.3 },
  { timestamp: new Date(Date.now() - 3 * 3600_000).toISOString(), db: -25.8 },
  { timestamp: new Date(Date.now() - 2.5 * 3600_000).toISOString(), db: -29.1 },
  { timestamp: new Date(Date.now() - 1.5 * 3600_000).toISOString(), db: -26.6 },
  { timestamp: new Date(Date.now() - 0.8 * 3600_000).toISOString(), db: -28.4 },
];

type BruxismEvent = { timestamp: string; db: number; clipUri?: string; feedback?: 'confirmed' | 'rejected' };

function buildHourlyChart(events: BruxismEvent[]) {
  if (events.length === 0) return null;
  const counts: Record<number, number> = {};
  events.forEach(e => {
    const h = new Date(e.timestamp).getHours();
    counts[h] = (counts[h] || 0) + 1;
  });
  const hours = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return {
    labels: hours.map(h => `${h}시`),
    data:   hours.map(h => counts[h]),
    peakHour: hours.reduce((a, b) => counts[a] >= counts[b] ? a : b),
    peakCount: Math.max(...hours.map(h => counts[h])),
  };
}

export default function Report() {
  const [events, setEvents]             = useState<BruxismEvent[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const loadEvents = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setEvents(raw ? JSON.parse(raw) : []);
  }, []);

  useFocusEffect(useCallback(() => {
    loadEvents();
    return () => {
      soundRef.current?.stopAsync();
      soundRef.current?.unloadAsync();
      soundRef.current = null;
      setPlayingIndex(null);
    };
  }, [loadEvents]));

  async function handleFeedback(originalIndex: number, type: 'confirmed' | 'rejected') {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const all: BruxismEvent[] = raw ? JSON.parse(raw) : [];
    all[originalIndex] = { ...all[originalIndex], feedback: type };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    setEvents(all);
  }

  async function handleAddDummy() {
    const raw    = await AsyncStorage.getItem(STORAGE_KEY);
    const existing: BruxismEvent[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...DUMMY_EVENTS]));
    loadEvents();
  }

  async function togglePlay(index: number, clipUri: string) {
    if (playingIndex === index) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setPlayingIndex(null);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: clipUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            soundRef.current?.unloadAsync();
            soundRef.current = null;
            setPlayingIndex(null);
          }
        },
      );
      soundRef.current = sound;
      setPlayingIndex(index);
    } catch (e) {
      Alert.alert('재생 오류', '클립을 재생할 수 없습니다.');
      console.error(e);
    }
  }

  function handleClear() {
    Alert.alert('데이터 초기화', '모든 기록과 녹음 클립을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await soundRef.current?.stopAsync();
          await soundRef.current?.unloadAsync();
          soundRef.current = null;
          setPlayingIndex(null);
          await AsyncStorage.removeItem(STORAGE_KEY);
          await FileSystem.deleteAsync(CLIPS_DIR, { idempotent: true });
          setEvents([]);
        },
      },
    ]);
  }

  const reversed   = [...events].reverse();
  const hourly     = buildHourlyChart(events);
  const avgDb      = events.length > 0
    ? events.reduce((s, e) => s + e.db, 0) / events.length
    : null;

  const chartData = hourly
    ? { labels: hourly.labels, datasets: [{ data: hourly.data }] }
    : { labels: ['데이터 없음'], datasets: [{ data: [0] }] };

  function renderHeader() {
    return (
      <View>
        {/* 요약 카드 */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryCardPrimary]}>
            <Text style={styles.summaryCardLabel}>총 감지 횟수</Text>
            <Text style={styles.summaryCardValue}>{events.length}회</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCardLabel}>평균 소음</Text>
            <Text style={[styles.summaryCardValue, styles.summaryCardValueDark]}>
              {avgDb !== null ? `${avgDb.toFixed(1)} dB` : '—'}
            </Text>
          </View>
        </View>

        {hourly && (
          <View style={styles.summaryCardFull}>
            <Text style={styles.summaryCardLabel}>가장 활발한 시간대</Text>
            <Text style={[styles.summaryCardValue, styles.summaryCardValueDark]}>
              {hourly.peakHour}시 ({hourly.peakCount}회)
            </Text>
          </View>
        )}

        {/* 차트 */}
        <Text style={styles.sectionTitle}>시간대별 이갈이 횟수</Text>
        <View style={styles.chartCard}>
          {events.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Text style={styles.chartEmptyText}>수면 감지 데이터가 없습니다.</Text>
            </View>
          ) : (
            <BarChart
              data={chartData}
              width={SCREEN_WIDTH - 56}
              height={180}
              fromZero
              showValuesOnTopOfBars
              withInnerLines={false}
              chartConfig={{
                backgroundGradientFrom: '#fff',
                backgroundGradientTo:   '#fff',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(79, 70, 229, ${opacity})`,
                labelColor: () => '#888',
                barPercentage: 0.6,
                propsForLabels: { fontSize: 11 },
              }}
              style={{ borderRadius: 8, marginLeft: -16 }}
              yAxisLabel=""
              yAxisSuffix="회"
            />
          )}
        </View>

        {/* 클립 리스트 헤더 */}
        {events.length > 0 && (
          <Text style={styles.sectionTitle}>녹음 클립</Text>
        )}
      </View>
    );
  }

  function renderItem({ item, index }: { item: BruxismEvent; index: number }) {
    const originalIndex = events.length - 1 - index;
    const isPlaying = playingIndex === originalIndex;
    const fb = item.feedback;
    return (
      <View style={styles.eventCard}>
        <Text style={styles.eventIndex}>#{events.length - index}</Text>
        <View style={styles.eventInfo}>
          <Text style={styles.eventTime}>
            {new Date(item.timestamp).toLocaleString('ko-KR')}
          </Text>
          <Text style={styles.eventDb}>{item.db.toFixed(1)} dBFS</Text>
        </View>
        <View style={styles.eventActions}>
          {item.clipUri ? (
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.playBtnActive]}
              onPress={() => togglePlay(originalIndex, item.clipUri!)}
            >
              <Text style={[styles.playBtnText, isPlaying && styles.playBtnTextActive]}>
                {isPlaying ? '■' : '▶'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.playBtnPlaceholder} />
          )}
          <TouchableOpacity
            style={[styles.fbBtn, fb === 'confirmed' && styles.fbBtnConfirmed]}
            onPress={() => handleFeedback(originalIndex, 'confirmed')}
          >
            <Text style={[styles.fbBtnText, fb !== undefined && fb !== 'confirmed' && styles.fbBtnDim]}>✅</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fbBtn, fb === 'rejected' && styles.fbBtnRejected]}
            onPress={() => handleFeedback(originalIndex, 'rejected')}
          >
            <Text style={[styles.fbBtnText, fb !== undefined && fb !== 'rejected' && styles.fbBtnDim]}>❌</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderFooter() {
    if (events.length === 0) return null;
    return (
      <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
        <Text style={styles.clearButtonText}>데이터 초기화</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* 헤더 타이틀 + 더미 버튼 */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>수면 리포트</Text>
        <TouchableOpacity style={styles.dummyBtn} onPress={handleAddDummy}>
          <Text style={styles.dummyBtnText}>테스트 데이터</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={reversed}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              기록된 데이터가 없습니다.{'\n'}수면 감지를 시작해 보세요.
            </Text>
          </View>
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f8f9fa', paddingTop: 60 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  title:       { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  dummyBtn:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#ccc' },
  dummyBtnText: { fontSize: 11, color: '#999' },

  list: { paddingHorizontal: 20, paddingBottom: 40 },

  summaryRow:          { flexDirection: 'row', gap: 12, marginBottom: 12 },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardPrimary:      { backgroundColor: '#4f46e5' },
  summaryCardFull: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryCardLabel:        { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginBottom: 6, fontWeight: '500' },
  summaryCardValue:        { fontSize: 26, fontWeight: '800', color: '#fff' },
  summaryCardValueDark:    { color: '#1a1a2e', fontSize: 22 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },

  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  chartEmpty:     { height: 180, alignItems: 'center', justifyContent: 'center' },
  chartEmptyText: { color: '#ccc', fontSize: 14 },

  emptyBox:  { paddingTop: 60, alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#aaa', textAlign: 'center', lineHeight: 24 },

  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  eventIndex:          { fontSize: 13, color: '#4f46e5', fontWeight: '700', width: 36 },
  eventInfo:           { flex: 1 },
  eventTime:           { fontSize: 13, color: '#444' },
  eventDb:             { fontSize: 12, color: '#e53e3e', fontWeight: '600', marginTop: 2 },
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1.5, borderColor: '#4f46e5',
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnActive:       { backgroundColor: '#4f46e5' },
  playBtnText:         { fontSize: 12, color: '#4f46e5' },
  playBtnTextActive:   { color: '#fff' },
  playBtnPlaceholder:  { width: 34 },

  eventActions:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fbBtn:           { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' },
  fbBtnConfirmed:  { backgroundColor: '#d1fae5' },
  fbBtnRejected:   { backgroundColor: '#fee2e2' },
  fbBtnText:       { fontSize: 14 },
  fbBtnDim:        { opacity: 0.25 },

  clearButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e53e3e',
    alignItems: 'center',
  },
  clearButtonText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
});
