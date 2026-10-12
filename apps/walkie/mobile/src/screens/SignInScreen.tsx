import { useState } from 'react';
import { Body, Button, ErrorText, Field, Screen, Title } from '../ui/kit';
import { config } from '../config';
import { devSignIn, sendEmailCode, verifyEmailCode } from '../auth';
import { describeError } from '../errors';

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (config.authMode === 'dev') {
    return (
      <Screen>
        <Title>Walkie (development)</Title>
        <Body muted>Development sign-in: pick any handle. The same handle always signs in as the same test user. Production builds use email sign-in.</Body>
        <Field value={email} onChangeText={setEmail} placeholder="handle, e.g. alice" autoCapitalize="none" autoCorrect={false} />
        <Button label="Sign in" busy={busy} disabled={!/^[a-z0-9_-]{2,32}$/i.test(email)} onPress={act(async () => { await devSignIn(email.trim()); onSignedIn(); })} />
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Sign in to Walkie</Title>
      {!sent ? (
        <>
          <Body muted>We will email you a 6-digit code.</Body>
          <Field value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Button label="Send code" busy={busy} disabled={!email.includes('@')} onPress={act(async () => { await sendEmailCode(email.trim()); setSent(true); })} />
        </>
      ) : (
        <>
          <Body muted>Enter the code sent to {email}.</Body>
          <Field value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" maxLength={10} />
          <Button label="Verify" busy={busy} disabled={code.length < 6} onPress={act(async () => { await verifyEmailCode(email.trim(), code.trim()); onSignedIn(); })} />
          <Button label="Use a different email" kind="secondary" onPress={() => { setSent(false); setCode(''); }} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
