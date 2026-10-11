import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = {
  bg: '#0B1220',
  card: '#141D2F',
  border: '#24304A',
  text: '#E8EDF7',
  muted: '#93A1BC',
  accent: '#3B82F6',
  speaking: '#16A34A',
  receiving: '#0EA5E9',
  busy: '#D97706',
  danger: '#DC2626',
};

export function Screen({ children }: { children: ReactNode }) {
  return <View style={s.screen}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[s.body, muted && { color: colors.muted }]}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[s.field, props.style]} />;
}

export function Button({ label, onPress, kind = 'primary', busy, disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={s.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={s.error}>{children}</Text>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 24, gap: 12 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  field: { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 17 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 17, fontWeight: '600' },
  error: { color: '#FCA5A5', fontSize: 15 },
});
