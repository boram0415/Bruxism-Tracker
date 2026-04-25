import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const TIPS = [
  {
    title: '스트레스 관리',
    body: '명상·심호흡·요가 등 이완 훈련을 꾸준히 하면 수면 중 턱 근육 긴장을 줄일 수 있습니다.',
  },
  {
    title: '취침 전 카페인·알코올 피하기',
    body: '카페인과 알코올은 수면의 질을 낮추고 근육 긴장을 높여 이갈이를 악화시킵니다. 취침 4~6시간 전부터 삼가세요.',
  },
  {
    title: '마그네슘 보충',
    body: '마그네슘은 근육 이완에 도움을 줍니다. 전문의와 상담 후 보충제 복용을 고려해 보세요.',
  },
  {
    title: '마우스가드 착용',
    body: '치과에서 맞춤 제작한 마우스가드는 치아 마모를 방지하고 턱 근육의 부담을 줄여줍니다.',
  },
  {
    title: '취침 전 턱 스트레칭',
    body: '입을 최대한 크게 벌렸다가 천천히 닫는 동작을 10회 반복하세요. 턱 근육의 긴장 해소에 효과적입니다.',
  },
];

export default function Tips() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>이갈이 완화 팁</Text>
      <Text style={styles.subtitle}>생활 습관 개선으로 증상을 줄여보세요</Text>

      {TIPS.map((tip, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.indexBadge}>
            <Text style={styles.indexText}>{index + 1}</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{tip.title}</Text>
            <Text style={styles.cardDesc}>{tip.body}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.disclaimer}>
        * 이 팁은 일반적인 정보 제공 목적이며, 증상이 심할 경우 반드시 전문의와 상담하세요.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  content: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    marginTop: 2,
    flexShrink: 0,
  },
  indexText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
  },
  disclaimer: {
    fontSize: 12,
    color: '#bbb',
    marginTop: 8,
    lineHeight: 18,
  },
});
