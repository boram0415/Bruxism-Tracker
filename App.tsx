import React, { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { supabase } from './src/lib/supabase';
import Auth from './src/screens/Auth';
import Home from './src/screens/Home';
import Report from './src/screens/Report';
import Tips from './src/screens/Tips';
import MyPage from './src/screens/MyPage';

const Tab = createBottomTabNavigator();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    return (
      <>
        <Auth />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: '#4f46e5',
            tabBarInactiveTintColor: '#aaa',
            tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#eee' },
            tabBarIcon: ({ focused }) => {
              const icons: Record<string, string> = {
                홈: '🌙',
                리포트: '📊',
                팁: '💡',
                마이페이지: '👤',
              };
              const size = focused ? 22 : 18;
              return <Text style={{ fontSize: size }}>{icons[route.name]}</Text>;
            },
          })}
        >
          <Tab.Screen name="홈" component={Home} />
          <Tab.Screen name="리포트" component={Report} />
          <Tab.Screen name="팁" component={Tips} />
          <Tab.Screen name="마이페이지" component={MyPage} />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </>
  );
}
