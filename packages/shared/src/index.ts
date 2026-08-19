export * from './types.js';
export * from './protocol.js';
export * from './codes.js';
export * from './roomEngine.js';
export * from './redactFor.js';
export * from './gameEngine.js';
export * from './clock.js';
export * from './timeControls.js';

export const PACKAGE_NAME = '@duo/shared';

export const scaffoldGreeting = (who: string): string =>
  `hello ${who} from ${PACKAGE_NAME}`;
