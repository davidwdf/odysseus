// Every line here is a way English reaches the screen that the `LocalizedString` brand cannot see,
// because the prop belongs to React Native and is typed `string`. See layers.json → view.bannedSyntax.
export const back = <Pressable accessibilityLabel="Back" />
export const field = <TextInput placeholder="Search stops" />
export const defaulted = ({ accessibilityLabel = 'Close' }) => accessibilityLabel
export const interpolated = (msg: string, n: number) => msg.replace('{n}', String(n))
