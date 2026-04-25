import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
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
import { CLIPS_DIR } from './Home';

const STORAGE_KEY = 'bruxism_events';

type BruxismEvent = { timestamp: string; db: number; clipUri?: string };

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

  function renderItem({ item, index }: { item: BruxismEvent; index: number }) {
    const reversedIndex = events.length - 1 - index;
    const isPlaying = playingIndex === reversedIndex;

    return (
      <View style={styles.eventCard}>
        <Text style={styles.eventIndex}>#{events.length - index}</Text>
        <View style={styles.eventInfo}>
          <Text style={styles.eventTime}>
            {new Date(item.timestamp).toLocaleString('ko-KR')}
          </Text>
          <Text style={styles.eventDb}>{item.db.toFixed(1)} dBFS</Text>
        </View>
        {item.clipUri ? (
          <TouchableOpacity
            style={[styles.playBtn, isPlaying && styles.playBtnActive]}
            onPress={() => togglePlay(reversedIndex, item.clipUri!)}
          >
            <Text style={[styles.playBtnText, isPlaying && styles.playBtnTextActive]}>
              {isPlaying ? '■' : '▶'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.playBtnPlaceholder} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>수면 리포트</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>이갈이 의심 감지</Text>
        <Text style={styles.summaryCount}>{events.length}회</Text>
      </View>

      {events.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            기록된 데이터가 없습니다.{'\n'}수면 감지를 시작해 보세요.
          </Text>
        </View>
      ) : (
        <FlatList
          data={[...events].reverse()}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
        />
      )}

      {events.length > 0 && (
        <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
          <Text style={styles.clearButtonText}>데이터 초기화</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8f9fa', paddingTop: 60, paddingHorizontal: 20 },
  title:        { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 20 },
  summaryCard: {
    backgroundColor: '#4f46e5',
    borderRadius: 14,
    paddingVertical: 20,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  summaryLabel:      { fontSize: 15, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  summaryCount:      { fontSize: 28, fontWeight: '800', color: '#fff' },
  emptyBox:          { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:         { fontSize: 15, color: '#aaa', textAlign: 'center', lineHeight: 24 },
  list:              { paddingBottom: 20 },
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
  eventIndex:        { fontSize: 13, color: '#4f46e5', fontWeight: '700', width: 36 },
  eventInfo:         { flex: 1 },
  eventTime:         { fontSize: 13, color: '#444' },
  eventDb:           { fontSize: 12, color: '#e53e3e', fontWeight: '600', marginTop: 2 },
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1.5, borderColor: '#4f46e5',
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnActive:       { backgroundColor: '#4f46e5' },
  playBtnText:         { fontSize: 12, color: '#4f46e5' },
  playBtnTextActive:   { color: '#fff' },
  playBtnPlaceholder:  { width: 34 },
  clearButton: {
    marginBottom: 20,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e53e3e',
    alignItems: 'center',
  },
  clearButtonText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
});
