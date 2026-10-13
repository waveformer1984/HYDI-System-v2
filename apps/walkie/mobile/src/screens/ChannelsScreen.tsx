import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { Api, ChannelSummary } from '../api';
import { describeError } from '../errors';
import { Body, Button, ErrorText, Field, Screen, Title, colors } from '../ui/kit';

export function ChannelsScreen({
  api,
  displayName,
  guest = false,
  notice = '',
  onOpen,
  onSettings,
}: {
  api: Api;
  displayName: string;
  /** Joined via an invite QR: can use invited channels but not create them. */
  guest?: boolean;
  notice?: string;
  onOpen: (c: ChannelSummary) => void;
  onSettings: () => void;
}) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels((await api.channels()).channels);
      setError('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (kind: 'create' | 'join', fn: () => Promise<ChannelSummary>) => {
    setBusy(kind);
    setError('');
    try {
      const c = await fn();
      setName('');
      setCode('');
      await load();
      onOpen(c);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={st.header}>
        <Title>Channels</Title>
        <Pressable accessibilityRole="button" onPress={onSettings} hitSlop={12}>
          <Text style={st.link}>{displayName} ⚙︎</Text>
        </Pressable>
      </View>
      <FlatList
        style={{ flexGrow: 0, maxHeight: '45%' }}
        data={channels}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
        ListEmptyComponent={<Body muted>No channels yet. Create one, or join with an invite code.</Body>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" style={st.row} onPress={() => onOpen(item)}>
            <Text style={st.rowTitle}>{item.name}</Text>
            <Text style={st.rowMeta}>{item.role === 'owner' ? 'Owner' : 'Member'}</Text>
          </Pressable>
        )}
      />
      {guest ? (
        <Body muted>You joined as a guest. To join another channel, scan its invite QR code with your camera.</Body>
      ) : (
        <>
          <Field value={name} onChangeText={setName} placeholder="New private channel name" maxLength={60} />
          <Button label="Create channel" busy={busy === 'create'} disabled={!name.trim()} onPress={() => act('create', () => api.createChannel(name.trim()))} />
        </>
      )}
      <Field value={code} onChangeText={setCode} placeholder="Invite code (XXXXX-XXXXX-XXXXX-XXXXX)" autoCapitalize="characters" autoCorrect={false} />
      <Button label="Join with code" kind="secondary" busy={busy === 'join'} disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 20} onPress={() => act('join', () => api.redeemInvite(code.trim()))} />
      <ErrorText>{error || notice}</ErrorText>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.accent, fontSize: 16 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 16, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  rowTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: 14 },
});
