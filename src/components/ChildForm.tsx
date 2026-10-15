import { Pressable, StyleSheet, View } from 'react-native';

import { formatAge } from '@/lib/dates';
import type { NewChild } from '@/lib/api';
import { t } from '@/strings.ru';
import { childColors, radius, space, usePalette } from '@/theme';
import { AVATARS, Avatar } from './art/Avatar';
import { DateField } from './DateField';
import { Field } from './Field';
import { T } from './T';

type Props = {
  value: NewChild;
  onChange: (v: NewChild) => void;
  errors?: { name?: string | null; birth_date?: string | null };
  testPrefix?: string;
};

export function ChildForm({ value, onChange, errors, testPrefix = 'child' }: Props) {
  const p = usePalette();
  const age = value.birth_date ? formatAge(value.birth_date) : '';
  return (
    <View style={styles.wrap}>
      <Field
        testID={`${testPrefix}-name`}
        label={t.setup.name}
        placeholder={t.setup.namePlaceholder}
        value={value.name}
        onChangeText={(name) => onChange({ ...value, name })}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={30}
        error={errors?.name}
      />
      <DateField
        testID={`${testPrefix}-birth`}
        label={t.setup.birthDate}
        value={value.birth_date}
        onChange={(birth_date) => onChange({ ...value, birth_date })}
        error={errors?.birth_date}
      />
      {age ? (
        <T v="small" muted>
          {t.childEdit.ageNow(age)}
        </T>
      ) : null}

      <T v="label">{t.setup.avatar}</T>
      <View style={styles.grid}>
        {AVATARS.map((id) => {
          const selected = value.avatar === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t.avatars[id]}
              onPress={() => onChange({ ...value, avatar: id })}
              style={[
                styles.avatarCell,
                { borderColor: selected ? p.primary : 'transparent', backgroundColor: p.card },
              ]}>
              <Avatar id={id} color={value.color} size={52} />
            </Pressable>
          );
        })}
      </View>

      <T v="label">{t.setup.color}</T>
      <View style={styles.grid}>
        {childColors.map((c) => {
          const selected = value.color.toLowerCase() === c.toLowerCase();
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={c}
              onPress={() => onChange({ ...value, color: c })}
              style={[styles.swatchOuter, { borderColor: selected ? p.text : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.m },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  avatarCell: { borderWidth: 3, borderRadius: radius.m, padding: 3 },
  swatchOuter: { borderWidth: 3, borderRadius: radius.pill, padding: 3 },
  swatch: { width: 40, height: 40, borderRadius: radius.pill },
});
