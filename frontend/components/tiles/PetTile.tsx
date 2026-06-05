import React from 'react';
import { Device, TileConfig } from '../../types';
import TileWrapper from './TileWrapper';
import { IconCat } from '../icons';
import { fluidIcon, fluidText2xl, fluidTextXs, fluidGap } from './tileScale';

// Pet card (Whisker pets): the pet's weight as the focal value plus today's
// litter-box visit count, in the B-Panels tile design language. Composed from
// the pet's `*_weight` + `*_visits_today` sensors in useDashboard.
interface PetState { weight: number | null; weightUnit?: string; visits: number | null }

const PetTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
  const st = (device.state || {}) as PetState;
  const weight = st.weight != null ? `${st.weight} ${st.weightUnit || 'lb'}` : '—';
  const visits = st.visits != null ? st.visits : null;

  return (
    <TileWrapper label={tile.label || device.name} accent="brand" isLocked={tile.isLocked} isEditor={isEditor} animation={tile.animation} className={cornerClassName}>
      <div className="flex flex-col items-center justify-center" style={fluidGap(0.5)}>
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 'clamp(2.5rem, 34cqmin, 4.5rem)',
            aspectRatio: '1 / 1',
            background: 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.02) 70%, transparent)',
            border: '1px solid rgb(255 255 255 / 0.12)',
          }}
        >
          <IconCat className="text-gray-200" style={fluidIcon(1.9)} />
        </div>
        <p className="font-bold tabular-nums text-gray-100" style={fluidText2xl}>{weight}</p>
        {visits != null && (
          <p className="text-gray-400" style={fluidTextXs}>{visits} visit{visits === 1 ? '' : 's'} today</p>
        )}
      </div>
    </TileWrapper>
  );
};

export default PetTile;
