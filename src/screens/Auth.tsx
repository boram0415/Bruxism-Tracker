import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert('로그인 실패', error.message);
    setLoading(false);
  }

  async function handleSignUp() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      Alert.alert('회원가입 실패', error.message);
    } else {
      Alert.alert('확인 이메일 발송', '이메일을 확인해 주세요.');
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {/* 타이틀 */}
        <Text style={styles.title}>Bruxism Tracker</Text>
        <Text style={styles.subtitle}>수면 중 이갈이를 분석하세요</Text>

        {/* 입력 폼 */}
        <TextInput
          style={styles.input}
          placeholder="이메일"
          placeholderTextColor="#aaa"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          placeholderTextColor="#aaa"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {/* 로그인 / 회원가입 버튼 */}
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonTextPrimary}>로그인</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonOutline]}
          onPress={handleSignUp}
          disabled={loading}
        >
          <Text style={styles.buttonTextOutline}>회원가입</Text>
        </TouchableOpacity>

        {/* 구분선 */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* 소셜 로그인 버튼 */}
        <TouchableOpacity
          style={[styles.button, styles.buttonSocial, { backgroundColor: '#FEE500' }]}
          onPress={() => console.log('카카오 로그인 (미구현)')}
        >
          <Text style={[styles.buttonTextSocial, { color: '#3C1E1E' }]}>카카오로 로그인</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonSocial, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' }]}
          onPress={() => console.log('구글 로그인 (미구현)')}
        >
          <Text style={[styles.buttonTextSocial, { color: '#333' }]}>Google로 로그인</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonSocial, { backgroundColor: '#000' }]}
          onPress={() => console.log('애플 로그인 (미구현)')}
        >
          <Text style={[styles.buttonTextSocial, { color: '#fff' }]}>Apple로 로그인</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: '#333',
    marginBottom: 12,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonPrimary: {
    backgroundColor: '#4f46e5',
    marginTop: 4,
  },
  buttonTextPrimary: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonOutline: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  buttonTextOutline: {
    color: '#4f46e5',
    fontSize: 15,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#aaa',
    fontSize: 13,
  },
  buttonSocial: {
    marginBottom: 10,
  },
  buttonTextSocial: {
    fontSize: 15,
    fontWeight: '600',
  },
});
