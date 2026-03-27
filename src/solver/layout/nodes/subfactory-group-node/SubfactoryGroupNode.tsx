import { NodeProps, NodeResizer } from '@xyflow/react';
import { Paper, Text, Group } from '@mantine/core';

export function SubfactoryGroupNode(props: NodeProps) {
  return (
    <div style={{ zIndex: -1, pointerEvents: 'none', width: '100%', height: '100%' }}>
      <NodeResizer minWidth={100} minHeight={30} isVisible={props.selected} />
      <Paper
        withBorder
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(50, 50, 50, 0.1)',
          borderColor: 'rgba(100, 100, 100, 0.3)',
          pointerEvents: 'none',
        }}
        radius="md"
        p="sm"
      >
        <Group justify="center" align="flex-start" h="100%">
          <Text size="sm" fw={800} c="dimmed" style={{ letterSpacing: 2 }}>
            {(props.data?.label as string)?.toUpperCase() ?? 'SUB-FACTORY'}
          </Text>
        </Group>
      </Paper>
    </div>
  );
}
