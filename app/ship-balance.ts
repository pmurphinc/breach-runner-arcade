/**
 * Fleet-wide point budget for ship statistics.
 *
 * These weights translate unlike units into one comparable total. The values
 * are deliberately simple and public so future balance changes cannot quietly
 * create an over-budget frame.
 */
// Explicit extension keeps this module directly loadable by Node's test runner.
import { SHIP_SPECIALS, type ShipSpec } from "./game-data.ts";

export const SHIP_BALANCE_CAP = 100;
export const SHIP_BALANCE_FLOOR = 90;

export const SHIP_BALANCE_WEIGHTS = {
  hull: 0.1,
  handling: 1.5,
  speed: 6,
  acceleration: 100,
  gunBase: 6,
  gunLevel: 6,
  thrust: 4,
} as const;

export type ShipBalanceBreakdown = {
  hull: number;
  handling: number;
  speed: number;
  acceleration: number;
  gun: number;
  thrust: number;
  special: number;
  total: number;
};

export function shipBalanceBreakdown(ship: ShipSpec): ShipBalanceBreakdown {
  const breakdown = {
    hull: ship.health * SHIP_BALANCE_WEIGHTS.hull,
    handling: ship.turn * SHIP_BALANCE_WEIGHTS.handling,
    speed: ship.maxSpeed * SHIP_BALANCE_WEIGHTS.speed,
    acceleration: ship.acceleration * SHIP_BALANCE_WEIGHTS.acceleration,
    gun: SHIP_BALANCE_WEIGHTS.gunBase + ship.gun * SHIP_BALANCE_WEIGHTS.gunLevel,
    thrust: ship.thrust * SHIP_BALANCE_WEIGHTS.thrust,
    special: SHIP_SPECIALS[ship.id].balancePoints,
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { ...breakdown, total: Math.round(total * 10) / 10 };
}

export function isShipWithinBudget(ship: ShipSpec) {
  const total = shipBalanceBreakdown(ship).total;
  return total >= SHIP_BALANCE_FLOOR && total <= SHIP_BALANCE_CAP;
}
