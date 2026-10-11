import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text } from 'react-native';
import type { Api } from '../api';
import { signOut } from '../auth';
import { describeError } from '../errors';
import { Body, Button, ErrorText, Screen, Title, colors } from '../ui/kit';

export function SettingsScreen({ api, onBack, onEditName, onSignedOut }: { api: Api; onBack: () => void; onEditName: () => void; onSignedOut: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'This deletes your profile, removes you from every channel, and deletes the channels you own for everyone in them. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError('');
            try {
              await api.deleteAccount();
              await signOut();
              onSignedOut();
            } catch (e) {
              setError(describeError(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Title>Settings</Title>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Text style={st.h}>Microphone</Text>
        <Body>
          Walkie turns the microphone on only while you hold the Talk button and the server has given you the turn. Joining a channel never turns it on. Letting go turns it off immediately.
        </Body>
        <Body muted>If you denied microphone access, you can allow it in your phone's settings for this app.</Body>
        <Button label="Open phone settings" kind="secondary" onPress={() => Linking.openSettings()} />

        <Text style={st.h}>Privacy</Text>
        <Body>
          Audio is sent live through the channel's media server to the other people in the channel and is not recorded, stored, transcribed or analysed. Audio is encrypted in transit (TLS for signalling, DTLS-SRTP for media) but it is not end-to-end encrypted: the media server can technically access it while relaying.
        </Body>

        <Button label="Change display name" kind="secondary" onPress={onEditName} />
        <Button label="Sign out" kind="secondary" onPress={async () => { await signOut(); onSignedOut(); }} />
        <Button label="Delete account" kind="danger" busy={busy} onPress={confirmDelete} />
        <ErrorText>{error}</ErrorText>
        <Button label="Back" kind="secondary" onPress={onBack} />
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({ h: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 } });
