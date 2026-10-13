import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, createApi, type ChannelSummary } from './src/api';
import { getAccessToken, signInWithTicket, signOut } from './src/auth';
import { parseWalkieLink, type WalkieLink } from './src/deeplink';
import { describeError } from './src/errors';
import { configProblem } from './src/config';
import { iosPtt } from './modules/walkie-ptt/src';
import { ChannelScreen } from './src/screens/ChannelScreen';
import { ChannelsScreen } from './src/screens/ChannelsScreen';
import { JoinScreen } from './src/screens/JoinScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { Body, Screen, Title, colors } from './src/ui/kit';

type Route =
  | { name: 'loading' }
  | { name: 'signin' }
  | { name: 'join'; code: string }
  | { name: 'profile' }
  | { name: 'channels' }
  | { name: 'channel'; channel: ChannelSummary }
  | { name: 'settings' };

export default function App() {
  const api = useMemo(() => createApi(getAccessToken), []);
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [me, setMe] = useState<{ userId: string; displayName: string | null; guest?: boolean } | null>(null);
  const [linkError, setLinkError] = useState('');
  // A QR link waiting for sign-in / a display name before it can be used.
  const pending = useRef<WalkieLink | null>(null);
  const problem = configProblem();

  const boot = useCallback(async () => {
    const link = pending.current;
    if (link?.kind === 'login') {
      pending.current = null;
      try {
        await signInWithTicket(link.ticket);
        setLinkError('');
      } catch (e) {
        setLinkError(`Owner sign-in failed: ${describeError(e)}`);
      }
    }
    if (!(await getAccessToken())) {
      const join = pending.current;
      return setRoute(join?.kind === 'join' ? { name: 'join', code: join.code } : { name: 'signin' });
    }
    try {
      const m = await api.me();
      setMe(m);
      if (!m.displayName) return setRoute({ name: 'profile' });
      const join = pending.current;
      if (join?.kind === 'join') {
        pending.current = null;
        try {
          const r = await api.join(join.code, m.displayName);
          return setRoute({ name: 'channel', channel: r.channel });
        } catch (e) {
          setLinkError(describeError(e));
        }
      }
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

  // Invite / owner sign-in QR links: at launch and while running.
  useEffect(() => {
    if (problem) return;
    const handle = (url: string | null) => {
      const link = parseWalkieLink(url);
      if (!link) return false;
      pending.current = link;
      setRoute({ name: 'loading' });
      void boot();
      return true;
    };
    void Linking.getInitialURL().then((url) => {
      if (!handle(url)) void boot();
    });
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
    return () => sub.remove();
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
      case 'join':
        screen = (
          <JoinScreen
            api={api}
            code={route.code}
            onJoined={(channel) => {
              pending.current = null;
              void api.me().then(setMe, () => undefined);
              setRoute({ name: 'channel', channel });
            }}
            onSignIn={() => setRoute({ name: 'signin' })}
          />
        );
        break;
      case 'profile':
        screen = (
          <ProfileScreen
            api={api}
            initial={me?.displayName ?? null}
            onSaved={(displayName) => {
              setMe((m) => (m ? { ...m, displayName } : m));
              // A pending invite link continues once a name exists.
              if (pending.current) void boot();
              else setRoute({ name: 'channels' });
            }}
          />
        );
        break;
      case 'channels':
        screen = (
          <ChannelsScreen
            api={api}
            displayName={me?.displayName ?? ''}
            guest={Boolean(me?.guest)}
            notice={linkError}
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
