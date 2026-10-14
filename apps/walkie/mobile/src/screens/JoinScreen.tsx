import { useEffect, useState } from 'react';
import type { Api, ChannelSummary } from '../api';
import { joinAsGuest } from '../auth';
import { describeError } from '../errors';
import { Body, Button, ErrorText, Field, Screen, Title } from '../ui/kit';

/**
 * Opened from an invite QR (protoforgewalkie://join/<code>) on a phone that is
 * not signed in: type a name and join that channel as a guest. No account.
 */
export function JoinScreen({
  api,
  code,
  onJoined,
  onSignIn,
}: {
  api: Api;
  code: string;
  onJoined: (c: ChannelSummary) => void;
  onSignIn: () => void;
}) {
  const [preview, setPreview] = useState<{ channelName: string; ownerName: string | null; guestJoin: boolean } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.previewInvite(code).then(setPreview, (e) => setError(describeError(e)));
  }, [api, code]);

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      onJoined(await joinAsGuest(code, name.trim()));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Walkie invite</Title>
      {preview ? (
        <Body>
          {preview.ownerName ? `${preview.ownerName} invited you to ` : 'You are invited to '}
          {preview.channelName}
        </Body>
      ) : null}
      {preview?.guestJoin ? (
        <>
          <Field value={name} onChangeText={setName} placeholder="Your name" maxLength={40} autoFocus />
          <Button label="Join and talk" busy={busy} disabled={!name.trim()} onPress={() => void join()} />
        </>
      ) : null}
      {preview && !preview.guestJoin ? <Body muted>This server needs you to sign in before joining.</Body> : null}
      <ErrorText>{error}</ErrorText>
      <Button label="I have an account — sign in" kind="secondary" onPress={onSignIn} />
    </Screen>
  );
}
