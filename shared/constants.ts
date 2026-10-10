/*
 * Blobby Volley Online
 * Physics constants ported from Blobby Volley 2 (src/GameConstants.h,
 * https://github.com/danielknobe/blobbyvolley2), GPL-2.0-or-later.
 * Copyright (C) 2006 Jonathan Sieber, Daniel Knobe.
 *
 * All values below are taken 1:1 from the Blobby Volley 2 source unless the
 * comment says otherwise. Units: pixels and "steps" (one physics step, dt = 1).
 */

// Border settings
export const LEFT_PLANE = 0;
export const RIGHT_PLANE = 800;

// Blobby settings
export const BLOBBY_HEIGHT = 89;
export const BLOBBY_UPPER_SPHERE = 19;
export const BLOBBY_UPPER_RADIUS = 25;
export const BLOBBY_LOWER_SPHERE = 13;
export const BLOBBY_LOWER_RADIUS = 33;

// Ground settings
export const GROUND_PLANE_HEIGHT_MAX = 500;
export const GROUND_PLANE_HEIGHT = GROUND_PLANE_HEIGHT_MAX - BLOBBY_HEIGHT / 2;

export const BLOBBY_MAX_JUMP_HEIGHT = GROUND_PLANE_HEIGHT - 206.375;
export const BLOBBY_JUMP_ACCELERATION = -15.1;
export const GRAVITATION =
  (BLOBBY_JUMP_ACCELERATION * BLOBBY_JUMP_ACCELERATION) / BLOBBY_MAX_JUMP_HEIGHT;
export const BLOBBY_JUMP_BUFFER = GRAVITATION / 2;

// Ball settings
export const BALL_RADIUS = 31.5;
export const BALL_GRAVITATION = 0.287;
export const BALL_COLLISION_VELOCITY = Math.sqrt(0.75 * RIGHT_PLANE * BALL_GRAVITATION);

// Net
export const NET_POSITION_X = RIGHT_PLANE / 2;
export const NET_POSITION_Y = 438;
export const NET_RADIUS = 7;
export const NET_SPHERE_POSITION = 284;

export const STANDARD_BALL_HEIGHT = 269 + BALL_RADIUS;
export const BLOBBY_SPEED = 4.5;
export const STANDARD_BALL_ANGULAR_VELOCITY = 0.1;

// From PhysicWorld.cpp
export const BLOBBY_ANIMATION_SPEED = 0.5;

// From GameLogic.cpp: steps that must pass until the next hit counts
export const SQUISH_TOLERANCE = 11;

// From data/config.xml defaults
export const STEPS_PER_SECOND = 75; // "gamefps"
export const DEFAULT_SCORE_TO_WIN = 15; // "scoretowin"

export const STEP_MS = 1000 / STEPS_PER_SECOND;

// Logical canvas size (our own choice; BV2 also renders at 800x600)
export const FIELD_WIDTH = 800;
export const FIELD_HEIGHT = 600;
