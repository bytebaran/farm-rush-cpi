import * as THREE from "three";
import { sourceMaterial, slicedSprite } from "./source-style.js";
const variantNames = ["", "Bus", "Bus_02", "Bus_03"];
// These UVs originate in glTF, whose textures use the opposite upload flip
// from Three.TextureLoader sprites. AO/normals must follow the mesh atlas.
export function prepareTruckDataTexture(texture) {
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
export function createTruckVisual(
  c,
  {
    models,
    textures,
    materialConfig,
    lidShadows,
    materialFactory = sourceMaterial,
  },
) {
  const group = new THREE.Group(),
    visual = new THREE.Group(),
    body =
      models[
        ["", "bus_inflatable", "bus_medium_inflatable", "bus_long_inflatable"][
          c.shapeId
        ]
      ].clone(true);
  group.add(visual);
  visual.add(body);
  const paint = c.colorId === 4 ? "yellow" : "purple",
    morphs = [];
  body.traverse((o) => {
    if (o.isMesh) {
      const name = o.material.name,
        key =
          name === "paint_cab"
            ? (c.shapeId === 1 ? "cab_small_" : "paint_") + paint
            : name === "paint_bed"
              ? "paint_" + paint
              : name;
      const actualKey =
        name === "cab_details" && c.shapeId !== 1 ? "cab_large_details" : key;
      const atlas =
        (name === "paint_cab" || name === "cab_details") && c.shapeId === 1
          ? "Picup02"
          : "Picup01";
      const normal = materialConfig.materials[actualKey].floats._UseNormalMap
        ? textures[atlas + "_N"]
        : null;
      o.material = materialFactory(
        materialConfig,
        actualKey,
        o.material.map,
        textures[atlas + "_AO"],
        normal,
      );
      if (o.morphTargetInfluences) {
        o.morphTargetInfluences = [...o.morphTargetInfluences];
        morphs.push(o);
      }
    }
  });
  const index = c.shapeId - 1;
  const arrow = slicedSprite(textures.PickupArrow, {
    pixels: [512, 512],
    width: 5.12,
    height: [6.767294, 9.3, 12.8][index],
    border: [0, 69, 0, 274],
  });
  arrow.scale.setScalar(0.144);
  arrow.position.set(0, 1.14, [0.0352, 0.043, 0.0123][index]);
  arrow.renderOrder = 20;
  visual.add(arrow);
  const shadow = slicedSprite(textures.PickupShadow, {
    pixels: [512, 512],
    width: 6.4745126,
    height: [9.105167, 10.831213, 13.69897][index],
    border: [0, 200, 0, 200],
    color: 0x000000,
    opacity: 0.4,
  });
  shadow.scale.setScalar(0.25224);
  shadow.rotation.y = Math.PI;
  shadow.position.set(
    index ? 0 : 0.0059,
    0.005,
    [0.0175, 0.021, -0.0258][index],
  );
  visual.add(shadow);
  const lidHeight = [4.7229495, 6.8430557, 10.875104][index],
    lidTexture = textures.PickupKasa.clone();
  lidTexture.wrapS = lidTexture.wrapT = THREE.RepeatWrapping;
  lidTexture.repeat.set(
    5 / (lidTexture.image.width / 100),
    lidHeight / (lidTexture.image.height / 100),
  );
  lidTexture.needsUpdate = true;
  const lid = slicedSprite(lidTexture, {
    pixels: [lidTexture.image.width, lidTexture.image.height],
    width: 5,
    height: lidHeight,
  });
  lid.material.color.setRGB(
    ...(c.colorId === 4
      ? [1, 0.9072689, 0.08018869]
      : [0.75881875, 0.23584905, 0.9433962]),
    THREE.SRGBColorSpace,
  );
  lid.scale.set(0.17933795, 1, 0.16516659);
  lid.rotation.y = Math.PI;
  lid.position.set(
    -0.005,
    [1.003, 0.9936, 1][index],
    [-0.381, -0.4053, -0.516][index],
  );
  lid.renderOrder = 18;
  visual.add(lid);
  const data = lidShadows[variantNames[c.shapeId]],
    lidShadow = slicedSprite(textures.PickupRollicShadow, {
      pixels: [512, 512],
      width: data.sizeBeforeScale[0],
      height: data.sizeBeforeScale[1],
      border: data.borderPixels,
      opacity: 0.2509804,
    });
  lidShadow.position.fromArray(data.flattenedBusLocal.position);
  lidShadow.position.y += 0.002;
  lidShadow.scale.fromArray(data.flattenedBusLocal.scale);
  lidShadow.renderOrder = 19;
  visual.add(lidShadow);
  return { group, visual, body, arrow, lid, lidShadow, shadow, morphs };
}
