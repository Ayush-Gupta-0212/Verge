// Matte dark sphere with a single soft top-left highlight and an amber rim
// glow biased toward the bottom-right — matches the Focus reference.
// No fluid bumps; the surface is quiet on purpose.

export const fluidSphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPos;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    vPos = position;
    gl_Position = projectionMatrix * mv;
  }
`;

export const fluidSphereFragment = /* glsl */ `
  precision highp float;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPos;

  uniform float uTime;
  uniform vec3  uRim;        // amber rim color
  uniform vec3  uHighlight;  // soft warm highlight
  uniform float uPulse;      // 0..1 breathing pulse

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);

    // Lambertian fill with a soft top-left key light.
    vec3 L = normalize(vec3(-0.6, 0.8, 0.7));
    float diff = max(dot(N, L), 0.0);

    // Specular pop on the top-left.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.55;

    // Base — very dark, slightly warm.
    vec3 base = mix(vec3(0.030, 0.024, 0.020), vec3(0.06, 0.05, 0.045), diff);
    base += spec * uHighlight;

    // Rim — fresnel weighted toward the bottom-right direction.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    float bias = clamp(dot(N, normalize(vec3(0.55, -0.5, 0.5))), 0.0, 1.0);
    float rimAmount = fres * (0.35 + bias * 0.85);
    vec3 rim = uRim * rimAmount * (0.9 + 0.25 * uPulse);

    vec3 col = base + rim;

    gl_FragColor = vec4(col, 1.0);
  }
`;
