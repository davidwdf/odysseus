// The control: the same four shapes done correctly must NOT trip the rules.
export const back = <Pressable accessibilityLabel={t(locale, 'back')} />
export const field = <TextInput placeholder={t(locale, 'searchStopPlaceholder')} />
export const counted = (n: number) => t(locale, 'moreRoutes', { n })
export const trimmed = (s: string) => s.replace(/\s+/g, ' ')
