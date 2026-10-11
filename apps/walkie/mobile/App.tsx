import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, createApi, type ChannelSummary } from './src/api';
import { getAccessToken, signOut } from './src/auth';
import { configProblem } from './src/config';
import { iosPtt } from './modules/walkie-ptt/src';
import { ChannelScreen } from './src/screens/ChannelScreen';
import { ChannelsScreen } from './src/screens/ChannelsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { Body, Screen, Title, colors } from './src/ui/kit';

type Route = { name: 'loading' } | { name: 'signin' } | { name: 'profile' } | { name: 'channels' } | { name: 'channel'; channel: ChannelSummary } | { name: 'settings' };

export default function App() {
  const api = useMemo(() => createApi(getAccessToken), []);
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [me, setMe] = useState<{ userId: string; displayName: string | null } | null>(null);
  const problem = configProblem();

  const boot = useCallback(async () => {
    if (!(await getAccessToken())) return setRoute({ name: 'signin' });
    try {
      const m = await api.me();
      setMe(m);
      if (!m.displayName) return setRoute({ name: 'profile' });
      // iOS PushToTalk: if iOS restored a joined channel (e.g. the app was
      // launched by a PTT push), go straight back into it so audio can flow.
      const pttChannel = iosPtt.activeChannelId();
      if (pttChannel) {
        const found = (await api.channels().catch(() => ({ channels: [] as ChannelSummary[] }))).channels.find((c) => c.id === pttChannel);
        if (found) return setRoute({ name: 'channel', channel: found });
      }
      setRoute({ name: 'channels' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await signOut();
        setRoute({ name: 'signin' });
      } else {
        setRoute({ name: 'channels' });
      }
    }
  }, [api]);

  useEffect(() => {
    if (!problem) void boot();
  }, [boot, problem]);

  let screen;
  if (problem) {
    screen = (
      <Screen>
        <Title>Build not configured</Title>
        <Body>{problem}</Body>
      </Screen>
    );
  } else {
    switch (route.name) {
      case 'loading':
        screen = (
          <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
            <ActivityIndicator color={colors.text} />
          </View>
        );
        break;
      case 'signin':
        screen = <SignInScreen onSignedIn={boot} />;
        break;
      case 'profile':
        screen = (
          <ProfileScreen
            api={api}
            initial={me?.displayName ?? null}
            onSaved={(displayName) => {
              setMe((m) => (m ? { ...m, displayName } : m));
              setRoute({ name: 'channels' });
            }}
          />
        );
        break;
      case 'channels':
        screen = (
          <ChannelsScreen
            api={api}
            displayName={me?.displayName ?? ''}
            onOpen={(channel) => setRoute({ name: 'channel', channel })}
            onSettings={() => setRoute({ name: 'settings' })}
          />
        );
        break;
      case 'channel':
        screen = <ChannelScreen key={route.channel.id} api={api} channel={route.channel} selfId={me?.userId ?? ''} onBack={() => setRoute({ name: 'channels' })} />;
        break;
      case 'settings':
        screen = (
          <SettingsScreen
            api={api}
            onBack={() => setRoute({ name: 'channels' })}
            onEditName={() => setRoute({ name: 'profile' })}
            onSignedOut={() => {
              setMe(null);
              setRoute({ name: 'signin' });
            }}
          />
        );
        break;
    }
  }

  return (
    <>
      <StatusBar style="light" />
      {screen}
    </>
  );
}
