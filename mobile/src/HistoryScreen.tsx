import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { faceLabel, type CastLine } from './core/casting';
import { formatHistoryTime, type CastHistoryEntry } from './core/history';

const LINE_LABELS = ['初', '二', '三', '四', '五', '上'];

function HistoryLineShape({ line, compact = false }: { line: CastLine; compact?: boolean }) {
  const color = line.moving ? '#8b6a31' : '#292722';
  return (
    <View style={[styles.lineShape, compact && styles.lineShapeCompact]}>
      {line.yang ? (
        <View style={[styles.lineFull, { backgroundColor: color }]} />
      ) : (
        <>
          <View style={[styles.lineHalf, { backgroundColor: color }]} />
          <View style={[styles.lineHalf, { backgroundColor: color }]} />
        </>
      )}
    </View>
  );
}

function HistoryCard({
  entry,
  expanded,
  onToggle,
  onDelete,
}: {
  entry: CastHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatHistoryTime(entry.createdAt)}的六爻记录`}
        onPress={onToggle}
        style={({ pressed }) => [styles.cardSummary, pressed && styles.cardPressed]}
      >
        <View style={styles.miniHexagram}>
          {[6, 5, 4, 3, 2, 1].map((number) => (
            <HistoryLineShape key={number} line={entry.lines[number - 1]} compact />
          ))}
        </View>

        <View style={styles.cardText}>
          <Text style={styles.cardDate}>{formatHistoryTime(entry.createdAt)}</Text>
          <Text style={styles.cardMeta}>六爻完整记录</Text>
          <Text style={styles.sumSequence}>
            {entry.lines.map((line) => line.sum).join(' · ')}
          </Text>
        </View>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color="#726b61"
        />
      </Pressable>

      {expanded && (
        <View style={styles.cardDetails}>
          <Text style={styles.detailCaption}>自下而上记录，画面自上而下排列</Text>
          {[6, 5, 4, 3, 2, 1].map((number) => {
            const line = entry.lines[number - 1];
            return (
              <View key={number} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{LINE_LABELS[number - 1]}</Text>
                <HistoryLineShape line={line} />
                <Text style={styles.detailFaces}>
                  {line.faces.map(faceLabel).join(' · ')}
                </Text>
                <Text style={styles.detailSum}>{line.sum}</Text>
              </View>
            );
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除这条历史记录"
            onPress={onDelete}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={16} color="#7c5548" />
            <Text style={styles.deleteText}>删除记录</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function HistoryScreen({
  history,
  onBack,
  onDelete,
  onClear,
}: {
  history: CastHistoryEntry[];
  onBack: () => void;
  onDelete: (entry: CastHistoryEntry) => void;
  onClear: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回起卦"
          hitSlop={12}
          onPress={onBack}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={29} color="#25231f" />
        </Pressable>
        <Text style={styles.title}>起卦历史</Text>
        {history.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空全部历史记录"
            hitSlop={10}
            onPress={onClear}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>清空</Text>
          </Pressable>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="time-outline" size={34} color="#8b6a31" />
          </View>
          <Text style={styles.emptyTitle}>还没有历史记录</Text>
          <Text style={styles.emptyBody}>完成六轮抛掷后，会自动保存在这里</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        >
          <Text style={styles.listIntro}>共 {history.length} 次完整起卦</Text>
          {history.map((entry) => (
            <HistoryCard
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((current) => current === entry.id ? null : entry.id)}
              onDelete={() => onDelete(entry)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#e7e3dc',
  },
  header: {
    height: 58,
    marginHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  title: {
    color: '#25231f',
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: 1.8,
  },
  clearButton: {
    position: 'absolute',
    right: 0,
    minWidth: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  clearText: {
    color: '#7c5548',
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 12,
  },
  listIntro: {
    color: '#746e65',
    fontSize: 14,
    marginBottom: 2,
  },
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(117, 101, 80, 0.34)',
    borderRadius: 18,
    backgroundColor: 'rgba(250, 247, 239, 0.72)',
  },
  cardSummary: {
    minHeight: 124,
    paddingHorizontal: 15,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardPressed: {
    backgroundColor: 'rgba(139, 106, 49, 0.07)',
  },
  miniHexagram: {
    width: 80,
    gap: 5,
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  cardDate: {
    color: '#2e2b26',
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  cardMeta: {
    color: '#746e65',
    fontSize: 13,
  },
  sumSequence: {
    color: '#8b6a31',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  lineShape: {
    flex: 1,
    minWidth: 74,
    height: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  lineShapeCompact: {
    flex: 0,
    width: 80,
    minWidth: 80,
    height: 6,
    gap: 8,
  },
  lineFull: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  lineHalf: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  cardDetails: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(117, 101, 80, 0.22)',
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 10,
  },
  detailCaption: {
    color: '#8a8379',
    fontSize: 12,
    marginBottom: 7,
  },
  detailRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailLabel: {
    width: 22,
    color: '#5d5952',
    fontSize: 14,
  },
  detailFaces: {
    width: 72,
    color: '#6b655c',
    fontSize: 12,
    textAlign: 'right',
  },
  detailSum: {
    width: 15,
    color: '#8b6a31',
    fontSize: 13,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  deleteButton: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  deleteText: {
    color: '#7c5548',
    fontSize: 13,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 106, 49, 0.34)',
    backgroundColor: 'rgba(250, 247, 239, 0.55)',
    marginBottom: 18,
  },
  emptyTitle: {
    color: '#302d28',
    fontSize: 19,
    fontWeight: '600',
  },
  emptyBody: {
    color: '#777067',
    fontSize: 14,
    marginTop: 7,
  },
});
