import * as THREE from "three";

// The Unity project renders in Gamma with TCP2's smooth color ramp. These
// materials preserve that authored response instead of treating the art as PBR.
export function sourceMaterial(
  config,
  key,
  map = null,
  ao = null,
  normalMap = null,
) {
  const s = config.materials[key],
    f = s.floats,
    c = s.colors;
  const vector = (a, fallback) =>
    new THREE.Vector3(...(a ?? fallback).slice(0, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      baseMap: { value: map },
      hasMap: { value: map ? 1 : 0 },
      occlusionMap: { value: ao },
      hasAO: { value: ao ? 1 : 0 },
      detailNormalMap: { value: normalMap },
      hasNormalMap: { value: normalMap && f._UseNormalMap ? 1 : 0 },
      normalScale: { value: f._BumpScale ?? 1 },
      baseColor: { value: vector(c._BaseColor, [1, 1, 1]) },
      shadeColor: { value: vector(c._SColor, [0.2, 0.2, 0.2]) },
      highlightColor: { value: vector(c._HColor, [1, 1, 1]) },
      specularColor: { value: vector(c._SpecularColor, [0.75, 0.75, 0.75]) },
      lightDirection: {
        value: vector(
          config.lightDirection,
          [0.217919581, 0.968147665, -0.123292986],
        ).normalize(),
      },
      ambient: { value: vector(config.ambient, [0.6, 0.6, 0.6]) },
      lightIntensity: { value: config.lightIntensity },
      threshold: { value: f._RampThreshold ?? 1 },
      smoothing: { value: f._RampSmoothing ?? 0.78 },
      roughness: { value: f._SpecularRoughness ?? 0.582 },
      specular: { value: f._UseSpecular ?? 0 },
      indirect: { value: f._IndirectIntensity ?? 1 },
      flash: { value: 0 },
    },
    vertexShader: `
      varying vec2 sourceUv;
      varying vec3 sourceNormal;
      varying vec3 sourcePosition;
      #include <morphtarget_pars_vertex>
      void main(){
        sourceUv=uv;
        vec3 transformed=position;
        vec3 objectNormal=normal;
        #include <morphinstance_vertex>
        #include <morphnormal_vertex>
        #include <morphtarget_vertex>
        vec4 p=vec4(transformed,1.);
        vec3 n=objectNormal;
        #ifdef USE_INSTANCING
          p=instanceMatrix*p;
          n=mat3(instanceMatrix)*n;
        #endif
        vec4 world=modelMatrix*p;
        sourcePosition=world.xyz;
        sourceNormal=normalize(vec3(vec4(normalMatrix*n,0.)*viewMatrix));
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader: `
      uniform sampler2D baseMap;
      uniform sampler2D occlusionMap;
      uniform sampler2D detailNormalMap;
      uniform float hasNormalMap,normalScale;
      uniform float hasAO;
      uniform float hasMap,threshold,smoothing,roughness,specular,indirect,lightIntensity,flash;
      uniform vec3 baseColor,shadeColor,highlightColor,specularColor,lightDirection,ambient;
      varying vec2 sourceUv;
      varying vec3 sourceNormal;
      varying vec3 sourcePosition;
      vec3 toGamma(vec3 v){return mix(1.055*pow(max(v,vec3(0.)),vec3(1./2.4))-.055,v*12.92,lessThanEqual(v,vec3(.0031308)));}
      vec3 detailNormal(vec3 n){
        // The glTF exporter inverted V. Derive the tangent frame in the
        // original Unity UV convention while sampling the glTF-aligned PNG.
        vec2 unityUv=vec2(sourceUv.x,1.-sourceUv.y);
        vec3 q0=dFdx(sourcePosition),q1=dFdy(sourcePosition);
        vec2 st0=dFdx(unityUv),st1=dFdy(unityUv);
        vec3 p1=cross(q1,n),p0=cross(n,q0);
        vec3 t=p1*st0.x+p0*st1.x,b=p1*st0.y+p0*st1.y;
        float frameLength=max(dot(t,t),dot(b,b));
        if(frameLength<1e-12)return n;
        float scale=inversesqrt(frameLength);
        vec3 sampled=texture2D(detailNormalMap,sourceUv).xyz*2.-1.;
        sampled.xy*=normalScale;
        return normalize(mat3(t*scale,b*scale,n)*sampled);
      }
      void main(){
        vec4 texel=hasMap>.5?texture2D(baseMap,sourceUv):vec4(1.);
        if(texel.a<.1)discard;
        vec3 albedo=baseColor*(hasMap>.5?toGamma(texel.rgb):vec3(1.));
        vec3 normal=normalize(sourceNormal);
        if(hasNormalMap>.5)normal=detailNormal(normal);
        float ndl=dot(normal,lightDirection);
        float ramp=smoothstep(threshold-smoothing*.5,threshold+smoothing*.5,ndl*.5+.5);
        float ao=hasAO>.5?texture2D(occlusionMap,sourceUv).r:1.;
        vec3 color=albedo*(mix(shadeColor,highlightColor,ramp)*lightIntensity+ambient*indirect*ao);
        if(specular>.5){
          vec3 viewDirection=normalize(cameraPosition-sourcePosition);
          float nh=max(0.,dot(normal,normalize(lightDirection+viewDirection)));
          float r=max(.00001,roughness),r2=r*r,r4=r2*r2;
          float denom=(nh*r4-nh)*nh+1.;
          float shine=sqrt(max(.0001,.05*r4/(denom*denom+1e-7)))*(1.-.28*r2*r);
          color+=shine*max(0.,ndl)*lightIntensity*specularColor;
        }
        gl_FragColor=vec4(mix(color,vec3(1.),flash),texel.a);
      }`,
  });
  material.name = key;
  return material;
}

// Unity SpriteRenderer sliced mode: stretch only the center, retain the pixel
// borders on the arrowhead/tail and painted slot corners.
export function slicedSprite(
  texture,
  {
    pixels,
    width,
    height,
    border = [0, 0, 0, 0],
    ppu = 100,
    color = 0xffffff,
    opacity = 1,
  },
) {
  const [imageW, imageH] = pixels,
    [left, bottom, right, top] = border;
  const bx = Math.min(1, width / ((left + right) / ppu || 1)),
    by = Math.min(1, height / ((bottom + top) / ppu || 1));
  const xs = [
    -width / 2,
    -width / 2 + (left / ppu) * bx,
    width / 2 - (right / ppu) * bx,
    width / 2,
  ];
  const zs = [
    -height / 2,
    -height / 2 + (bottom / ppu) * by,
    height / 2 - (top / ppu) * by,
    height / 2,
  ];
  const us = [0, left / imageW, 1 - right / imageW, 1],
    vs = [0, bottom / imageH, 1 - top / imageH, 1];
  const vertices = [],
    uvs = [],
    indices = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      vertices.push(xs[x], 0, zs[y]);
      uvs.push(us[x], vs[y]);
    }
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const a = y * 4 + x;
      indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  return new THREE.Mesh(g, mat);
}
