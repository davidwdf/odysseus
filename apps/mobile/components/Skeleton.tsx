import { View } from 'react-native'

/** Placeholder block shown while content loads. (Shimmer animation: polish slice.) */
export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`rounded-lg bg-surface-2 ${className}`} />
}
