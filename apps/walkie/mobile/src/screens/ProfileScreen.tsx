import { useState } from 'react';
import type { Api } from '../api';
import { describeError } from '../errors';
import { Body, Button, ErrorText, Field, Screen, Title } from '../ui/kit';

export function ProfileScreen({ api, initial, onSaved }: { api: Api; initial: string | null; onSaved: (name: string) => void }) {
  const [name, setName] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Screen>
      <Title>{initial ? 'Display name' : 'Choose a display name'}</Title>
      <Body muted>This is what other people in your channels see.</Body>
      <Field value={name} onChangeText={setName} placeholder="Display name" maxLength={40} autoFocus />
      <Button
        label="Save"
        busy={busy}
        disabled={!name.trim()}
        onPress={async () => {
          setBusy(true);
          setError('');
          try {
            const p = await api.setDisplayName(name.trim());
            onSaved(p.displayName);
          } catch (e) {
            setError(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
