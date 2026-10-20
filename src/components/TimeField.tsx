import { StyleSheet, View } from 'react-native';

import { Field } from './Field';

type Props = { label: string; value: string; onChange: (hhmm: string) => void; testID?: string };

/** Native (non-web) fallback: plain text HH:MM. The web version uses the system time picker. */
export function TimeField({ label, value, onChange, testID }: Props) {
  return (
    <View style={styles.wrap}>
      <Field testID={testID} label={label} value={value} onChangeText={onChange} placeholder="07:00" />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1 } });
