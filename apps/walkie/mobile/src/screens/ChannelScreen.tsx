import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { Api, ChannelDetail, ChannelSummary } from '../api';
import { describeError } from '../errors';
import { displayStatus, type DisplayStatus, type Notice } from '../ptt/machine';
import { useChannelSession } from '../ptt/useChannelSession';
import { Body, Button, ErrorText, Screen, Title, colors } from '../ui/kit';

const STATUS: Record<DisplayStatus, { label: string; color: string }> = {
  listening: { label: 'Listening', color: colors.muted },
  receiving: { label: 'Receiving', color: colors.receiving },
  requesting: { label: 'Requesting the turn…', color: colors.accent },
  speaking: { label: 'You are transmitting', color: colors.speaking },
  busy: { label: 'Busy — someone else is talking', color: colors.busy },
  connecting: { label: 'Connecting…', color: colors.muted },
  reconnecting: { label: 'Reconnecting…', color: colors.busy },
  disconnected: { label: 'Disconnected', color: colors.danger },
  mic_denied: { label: 'Microphone access is off', color: colors.danger },
};

const NOTICE: Record<Notice, string> = {
  not_connected: 'Not connected to the channel yet — wait for "Listening".',
  mic_denied: 'Walkie needs microphone access to transmit. Allow it in your phone settings; you can still listen without it.',
  busy: 'Someone else has the turn. Try again when they let go.',
  rate_limited: 'Too many presses — wait a moment.',
  turn_ended: 'Your turn was ended by the server.',
  max_duration: 'Maximum talk time reached. Release and press again to continue.',
  request_failed: 'Could not get the turn. Check your connection.',
  connection_lost: 'Connection lost while talking — transmission stopped.',
};

export function ChannelScreen({ api, channel, selfId, onBack }: { api: Api; channel: ChannelSummary; selfId: string; onBack: () => void }) {
  const session = useChannelSession(api, channel.id, selfId);
  const { state, presence, timing, ended, outputs } = session;
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [error, setError] = useState('');

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await api.channel(channel.id));
    } catch (e) {
      setError(describeError(e));
    }
  }, [api, channel.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, presence.length]);

  const status = displayStatus(state, selfId);
  const isOwner = (detail?.role ?? channel.role) === 'owner';
  const nameOf = useCallback(
    (id: string) => detail?.members.find((m) => m.userId === id)?.displayName ?? presence.find((p) => p.identity === id)?.name ?? 'Someone',
    [detail, presence],
  );
  const online = useMemo(() => new Set(presence.map((p) => p.identity)), [presence]);
  const speakerName = state.speaker && state.speaker.userId !== selfId ? nameOf(state.speaker.userId) : null;

  if (ended) {
    return (
      <Screen>
        <Title>{channel.name}</Title>
        <Body>{ended === 'removed' ? 'You are no longer a member of this channel.' : 'This channel was deleted.'}</Body>
        <Button label="Back to channels" onPress={onBack} />
      </Screen>
    );
  }

  const invite = async () => {
    try {
      const inv = await api.createInvite(channel.id);
      const hours = Math.round((inv.expiresAt - Date.now()) / 3600_000);
      await Share.share({ message: `Join my Walkie channel "${channel.name}" with code ${inv.code} (single use, expires in ${hours} h).` });
    } catch (e) {
      setError(describeError(e));
    }
  };

  const memberActions = (userId: string, name: string) => {
    if (!isOwner || userId === selfId) return;
    Alert.alert(name, 'Owner controls', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove from channel', onPress: () => api.removeMember(channel.id, userId).then(loadDetail, (e) => setError(describeError(e))) },
      { text: 'Block', style: 'destructive', onPress: () => api.block(channel.id, userId).then(loadDetail, (e) => setError(describeError(e))) },
    ]);
  };

  const leaveOrDelete = () =>
    Alert.alert(isOwner ? 'Delete channel?' : 'Leave channel?', isOwner ? 'Everyone will be disconnected and the channel removed.' : 'You will need a new invite to come back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isOwner ? 'Delete' : 'Leave',
        style: 'destructive',
        onPress: () => (isOwner ? api.deleteChannel(channel.id) : api.leave(channel.id)).then(onBack, (e) => setError(describeError(e))),
      },
    ]);

  const pttColor = status === 'speaking' ? colors.speaking : status === 'busy' ? colors.busy : status === 'requesting' ? colors.accent : colors.card;
  const pttEnabled = state.connection === 'connected';
  const pttLabel =
    status === 'speaking' ? 'TALKING\nrelease to stop' : status === 'requesting' ? 'WAIT…' : status === 'busy' ? 'BUSY' : state.mic === 'denied' ? 'MIC OFF' : 'HOLD\nTO TALK';

  return (
    <Screen>
      <View style={st.header}>
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}>
          <Text style={st.link}>‹ Channels</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={leaveOrDelete} hitSlop={12}>
          <Text style={[st.link, { color: colors.danger }]}>{isOwner ? 'Delete' : 'Leave'}</Text>
        </Pressable>
      </View>
      <Title>{channel.name}</Title>

      <View style={[st.banner, { borderColor: STATUS[status].color }]} accessibilityLiveRegion="polite">
        <Text style={[st.bannerText, { color: STATUS[status].color }]}>{STATUS[status].label}</Text>
        {speakerName ? <Text style={st.speaker}>🔊 {speakerName}</Text> : null}
      </View>
      {state.notice ? <Text style={st.notice}>{NOTICE[state.notice]}</Text> : null}
      {state.mic === 'denied' ? <Button label="Open settings to allow microphone" kind="secondary" onPress={() => Linking.openSettings()} /> : null}

      <View style={st.pttWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hold to talk"
          accessibilityHint="Press and hold to request the turn. Release to stop transmitting."
          disabled={!pttEnabled}
          onPressIn={session.press}
          onPressOut={session.release}
          style={[st.ptt, { backgroundColor: pttColor, opacity: pttEnabled ? 1 : 0.4 }]}
        >
          <Text style={st.pttText}>{pttLabel}</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
        <Text style={st.h}>Members</Text>
        {(detail?.members ?? []).map((m) => {
          const isOn = online.has(m.userId);
          const talking = state.speaker?.userId === m.userId;
          return (
            <Pressable key={m.userId} onLongPress={() => memberActions(m.userId, m.displayName ?? 'Member')} style={st.member}>
              <View style={[st.dot, { backgroundColor: talking ? colors.speaking : isOn ? colors.receiving : colors.border }]} />
              <Text style={st.memberName}>
                {m.displayName ?? 'Member'}
                {m.userId === selfId ? ' (you)' : ''}
              </Text>
              <Text style={st.memberMeta}>{talking ? 'talking' : isOn ? 'online' : 'offline'}{m.role === 'owner' ? ' · owner' : ''}</Text>
            </Pressable>
          );
        })}
        {isOwner ? <Body muted>Long-press a member to remove or block them.</Body> : null}
        {isOwner ? <Button label="Invite someone" kind="secondary" onPress={invite} /> : null}

        <Text style={st.h}>Audio output</Text>
        {Platform.OS === 'android' ? (
          <View style={st.chips}>
            {outputs.length === 0 ? <Body muted>Detecting outputs…</Body> : null}
            {outputs.map((o) => (
              <Pressable key={o} style={st.chip} onPress={() => session.selectOutput(o).then(session.refreshOutputs)}>
                <Text style={st.chipText}>{o}</Text>
              </Pressable>
            ))}
            <Pressable style={st.chip} onPress={session.refreshOutputs}>
              <Text style={st.chipText}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <Button label="Choose audio route (speaker / Bluetooth / headphones)" kind="secondary" onPress={() => session.selectOutput('')} />
        )}

        {timing ? (
          <Body muted>
            Last turn: press→grant {timing.pressToGrantMs} ms, grant→mic live {timing.grantToMicLiveMs} ms
          </Body>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: colors.accent, fontSize: 16 },
  banner: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 4 },
  bannerText: { fontSize: 18, fontWeight: '700' },
  speaker: { color: colors.text, fontSize: 16 },
  notice: { color: '#FDE68A', fontSize: 15 },
  pttWrap: { alignItems: 'center', paddingVertical: 8 },
  ptt: { width: 220, height: 220, borderRadius: 110, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.border },
  pttText: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  h: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  memberName: { color: colors.text, fontSize: 16, flex: 1 },
  memberMeta: { color: colors.muted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 15 },
});
