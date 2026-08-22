import React from 'react';
import { Text as SvgText } from 'react-native-svg';
import { Scene } from './Scene';
import { Bag, Bubble, Figure, Phone, Shadow, SoundWaves } from './Figures';

/**
 * One scene per onboarding screen.
 *
 * Each says the screen's idea in a picture, so the heading confirms what the
 * illustration already told you. If a scene could be swapped between two
 * screens without anyone noticing, it is decoration and should be cut.
 *
 * Palette is the reference's: saturated yellow, orange, blue, red and green
 * blocks against the lilac sky, black speech bubbles, and a second tone on each
 * figure so no torso is a single flat slab.
 */

const F = 'Poppins_700Bold';

/** 1. The word. Phone raised, sound leaving it, "help!" above her. */
export function SceneVoice() {
  return (
    <Scene>
      <Shadow x={186} y={272} rx={30} />
      <Figure
        x={186}
        y={272}
        scale={1.1}
        skin="mid"
        jacket="#FFC940"
        shirt="#FFFFFF"
        bottom="#E0483C"
        hair="buns"
        waving
      />
      <Phone x={264} y={176} scale={1.1} rotate={8} />
      <SoundWaves x={282} y={176} />
      <Bubble x={92} y={86} w={86}>
        <SvgText x={135} y={104} fill="#FFF" fontSize={15} fontFamily={F} textAnchor="middle">
          help!
        </SvgText>
      </Bubble>
    </Scene>
  );
}

/** 2. Hands free. Phone in the bag, still listening. */
export function SceneHandsFree() {
  return (
    <Scene>
      <Shadow x={196} y={274} rx={31} />
      <Figure
        x={196}
        y={274}
        scale={1.12}
        skin="deep"
        jacket="#2F7DD1"
        shirt="#EAF2FB"
        bottom="#2A2A55"
        hair="crop"
      />
      <Bag x={238} y={214} scale={1.05} />
      <SoundWaves x={266} y={214} />
      <Bubble x={78} y={98} w={112}>
        <SvgText x={134} y={116} fill="#FFF" fontSize={13} fontFamily={F} textAnchor="middle">
          hands free
        </SvgText>
      </Bubble>
    </Scene>
  );
}

/** 3. No signal, still sent. Sound going out both ways with nothing to carry it. */
export function SceneOffline() {
  return (
    <Scene>
      <Shadow x={200} y={274} rx={30} />
      <Figure
        x={200}
        y={274}
        scale={1.12}
        skin="light"
        jacket="#F2662F"
        shirt="#FFE8D6"
        bottom="#3B3B7A"
        hair="pony"
        waving
      />
      <SoundWaves x={266} y={196} />
      <SoundWaves x={134} y={196} flip />
      <Bubble x={82} y={84} w={130}>
        <SvgText x={147} y={102} fill="#FFF" fontSize={12.5} fontFamily={F} textAnchor="middle">
          no signal, still sent
        </SvgText>
      </Bubble>
    </Scene>
  );
}

/** 4. Somebody comes. Two figures converging. */
export function SceneHelpers() {
  return (
    <Scene>
      <Shadow x={142} y={274} rx={27} />
      <Shadow x={258} y={274} rx={27} />
      <Figure
        x={142}
        y={274}
        scale={1.04}
        skin="mid"
        jacket="#FFC940"
        shirt="#FFFFFF"
        bottom="#E0483C"
        hair="buns"
        waving
      />
      <Figure
        x={258}
        y={274}
        scale={1.04}
        skin="deep"
        jacket="#3FBE8F"
        shirt="#E6F7F0"
        bottom="#2A2A55"
        hair="crop"
        waving
        flip
      />
      <Bubble x={54} y={82} w={98}>
        <SvgText x={103} y={100} fill="#FFF" fontSize={13} fontFamily={F} textAnchor="middle">
          on my way
        </SvgText>
      </Bubble>
      <Bubble x={252} y={70} w={86}>
        <SvgText x={295} y={88} fill="#FFF" fontSize={13} fontFamily={F} textAnchor="middle">
          I'm here
        </SvgText>
      </Bubble>
    </Scene>
  );
}

/** 5. Privacy. Phone held close, nothing leaving it. */
export function ScenePrivate() {
  return (
    <Scene>
      <Shadow x={200} y={274} rx={30} />
      <Figure
        x={200}
        y={274}
        scale={1.12}
        skin="mid"
        jacket="#8672CE"
        shirt="#EDE6FA"
        bottom="#2A2A55"
        hair="bob"
      />
      <Phone x={240} y={206} scale={1.15} rotate={-6} />
      <Bubble x={74} y={92} w={148}>
        <SvgText x={148} y={110} fill="#FFF" fontSize={12} fontFamily={F} textAnchor="middle">
          stays on your phone
        </SvgText>
      </Bubble>
    </Scene>
  );
}

/** 6. Ready. Both waving, the send-off. */
export function SceneReady() {
  return (
    <Scene>
      <Shadow x={144} y={274} rx={27} />
      <Shadow x={256} y={274} rx={27} />
      <Figure
        x={144}
        y={274}
        scale={1.06}
        skin="light"
        jacket="#FFC940"
        shirt="#FFFFFF"
        bottom="#E0483C"
        hair="pony"
        waving
      />
      <Figure
        x={256}
        y={274}
        scale={1.06}
        skin="deep"
        jacket="#2F7DD1"
        shirt="#EAF2FB"
        bottom="#3FBE8F"
        hair="buns"
        waving
        flip
      />
      <Bubble x={50} y={76} w={104}>
        <SvgText x={102} y={94} fill="#FFF" fontSize={13} fontFamily={F} textAnchor="middle">
          you're set
        </SvgText>
      </Bubble>
      <Bubble x={248} y={92} w={92}>
        <SvgText x={294} y={110} fill="#FFF" fontSize={13} fontFamily={F} textAnchor="middle">
          let's go
        </SvgText>
      </Bubble>
    </Scene>
  );
}
