import { Field } from './Field';

type Props = { label: string; value: string; onChange: (iso: string) => void; error?: string | null; testID?: string };

/** Native (non-web) fallback: plain text in YYYY-MM-DD. The web version uses the system date picker. */
export function DateField({ label, value, onChange, error, testID }: Props) {
  return (
    <Field
      testID={testID}
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder="2017-03-14"
      keyboardType="numbers-and-punctuation"
      error={error}
    />
  );
}
