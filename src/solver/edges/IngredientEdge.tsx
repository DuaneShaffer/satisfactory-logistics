import {
  useGameSettingMaxBelt,
  useGameSettingMaxPipeline,
} from '@/games/gamesSlice';
import {
  FactoryConveyorBelts,
  FactoryPipelinesExclAlternates,
} from '@/recipes/FactoryBuilding';
import { FactoryItemImage } from '@/recipes/ui/FactoryItemImage';
import { alpha, Box, Group, Image, Text, Tooltip } from '@mantine/core';
import {
  BaseEdge,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
  useInternalNode,
  useStore,
} from '@xyflow/react';
import { last } from 'lodash';
import { FC } from 'react';
import { RepeatingNumber } from '@/core/intl/NumberFormatter';
import { FactoryItem, FactoryItemForm } from '@/recipes/FactoryItem';
import { getEdgeParams, getSpecialPath } from './utils';

export interface IIngredientEdgeData {
  resource: FactoryItem;
  value: number;
  [key: string]: unknown;
}

const INVERSE_GAP = 10;

const colorPalette = [
  '#e03131', '#c2255c', '#9c36b5', '#6741d9', '#3b5bdb', '#1971c2', 
  '#0c8599', '#099268', '#2f9e44', '#66a80f', '#f59f00', '#e8590c',
  '#5c940d', '#748ffc', '#40c057', '#fa5252'
];

function getResourceColor(id?: string): string {
  if (!id) return '#5e5e5e';
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colorPalette[Math.abs(hash) % colorPalette.length];
}

export const IngredientEdge: FC<EdgeProps<Edge<IIngredientEdgeData>>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  source,
  target,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  ...edgeProps
}) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const isBiDirectionEdge = data?.isBiDirectionEdge || false;

  // Per-edge selectors: only this edge re-renders when ITS nodes change selection.
  // Zustand skips re-renders when the returned boolean is unchanged.
  const isHighlighted = useStore(s => {
    const src = s.nodeLookup.get(source);
    const tgt = s.nodeLookup.get(target);
    return !!(src?.selected || tgt?.selected);
  });
  // anySelected is handled via CSS variable set imperatively by SolverLayout
  // so this component never re-renders just because something else was clicked.

  const maxBelt = useGameSettingMaxBelt();
  const maxPipeline = useGameSettingMaxPipeline();
  const isOverMaxBelt = maxBelt && (data?.value ?? 0) > maxBelt.conveyor!.speed;
  const isOverMaxPipeline =
    maxPipeline && (data?.value ?? 0) > maxPipeline.pipeline!.flowRate;

  const isOverMaxLogistic =
    data?.resource?.form === FactoryItemForm.Gas ||
    data?.resource?.form === FactoryItemForm.Liquid
      ? isOverMaxPipeline
      : isOverMaxBelt;

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );
  const edgePathParams = {
    sourceX: sx === tx ? sx + 0.0001 : sx,
    sourceY: sy === ty ? sy + 0.0001 : sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  };

  const [edgePath, labelX, labelY] = isBiDirectionEdge
    ? getSpecialPath(edgePathParams)
    : getBezierPath(edgePathParams);

  const duration = 60 / (data?.value ?? 0);

  // If we don't have a max belt, use the last one (Mk6)
  const usedBelt = maxBelt ?? last(FactoryConveyorBelts)!;
  // If we don't have a max pipeline, use the last one (Mk2)
  const usedPipeline = maxPipeline ?? last(FactoryPipelinesExclAlternates)!;

  const neededBelts =
    Math.ceil((data?.value ?? 0) / usedBelt.conveyor!.speed) ?? null;
  const neededPipelines =
    Math.ceil((data?.value ?? 0) / usedPipeline.pipeline!.flowRate) ?? null;

  const usedLogistic =
    data?.resource?.form === FactoryItemForm.Gas ||
    data?.resource?.form === FactoryItemForm.Liquid
      ? usedPipeline
      : usedBelt;
  const usedLogisticMax =
    data?.resource?.form === FactoryItemForm.Gas ||
    data?.resource?.form === FactoryItemForm.Liquid
      ? neededPipelines
      : neededBelts;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...edgeProps}
        style={{
          stroke: getResourceColor(data?.resource?.id),
          strokeWidth: isHighlighted ? 4 : 1.5,
          opacity: isHighlighted ? 1 : 'var(--edge-dim-opacity, 1)' as any,
          filter: isHighlighted ? `drop-shadow(0 0 5px ${getResourceColor(data?.resource?.id)})` : undefined,
          transition: 'opacity 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease',
        }}
      />
      {isHighlighted && (
        <circle 
          r="3" 
          fill="var(--mantine-color-indigo-3)"
        >
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      )}
      <EdgeLabelRenderer>
        <Box
          p={'4px'}
          className="nodrag"
          style={{
            pointerEvents: 'all',
            borderRadius: 4,
            backgroundColor: alpha(
              isOverMaxLogistic ? '#75341e' : 'var(--mantine-color-dark-6)',
              0.8,
            ),
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          opacity: isHighlighted ? 1 : 'var(--edge-dim-opacity, 1)' as any,
            transition: 'opacity 0.15s ease',
          }}
        >
          <Tooltip
            color="dark.8"
            label={
              <Group>
                <Image
                  src={usedLogistic.imagePath}
                  alt={usedLogistic.name}
                  w={24}
                  h={24}
                />
                <Text>
                  {usedLogisticMax}x {usedLogistic.name}
                </Text>
              </Group>
            }
          >
            <Group gap="4px">
              <FactoryItemImage size={16} id={data?.resource.id} />
              <Text size="10px">
                <RepeatingNumber value={data?.value} />
                /min
              </Text>
            </Group>
          </Tooltip>
        </Box>
      </EdgeLabelRenderer>
    </>
  );
};
