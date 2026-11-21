// Stopa Anki's browser port of the RWKV Big SM99 instant inference equations.
// Reference: JSchoreels/anki-rwkv, rwkv-family-2026-11-13,
// reference/small_model_recurrent.py. See public/models/rwkv/README.md.
// The pretrained weights have separate terms in WEIGHTS-NOTICE.md.
// Application source: AGPL-3.0-or-later. No external Rust dependencies.

use std::collections::BTreeMap;
use std::slice;

const D: usize = 128;
const K: usize = 32;
const HEADS: usize = 4;
const DEPTHS: [usize; 5] = [3, 4, 2, 3, 4];

struct Tensor { dims: Vec<usize>, data: Vec<f32> }
type Weights = BTreeMap<String, Tensor>;

struct Reader<'a> { bytes: &'a [u8], cursor: usize }
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ()> {
        let end = self.cursor.checked_add(n).ok_or(())?;
        let out = self.bytes.get(self.cursor..end).ok_or(())?;
        self.cursor = end;
        Ok(out)
    }
    fn u8(&mut self) -> Result<usize, ()> { Ok(self.take(1)?[0] as usize) }
    fn u16(&mut self) -> Result<usize, ()> { Ok(u16::from_le_bytes(self.take(2)?.try_into().map_err(|_| ())?) as usize) }
    fn u32(&mut self) -> Result<usize, ()> { Ok(u32::from_le_bytes(self.take(4)?.try_into().map_err(|_| ())?) as usize) }
}

fn read_weights(bytes: &[u8]) -> Result<Weights, ()> {
    let mut r = Reader { bytes, cursor: 0 };
    if r.take(13)? != b"ARWKVWEIGHTS1" { return Err(()); }
    let count = r.u32()?;
    if count != 504 { return Err(()); }
    let mut weights = BTreeMap::new();
    for _ in 0..count {
        let name_len = r.u16()?;
        let name = std::str::from_utf8(r.take(name_len)?).map_err(|_| ())?.to_owned();
        let rank = r.u8()?;
        if rank > 4 { return Err(()); }
        let mut dims = Vec::with_capacity(rank);
        let mut size = 1usize;
        for _ in 0..rank {
            let d = r.u32()?;
            size = size.checked_mul(d).ok_or(())?;
            dims.push(d);
        }
        let raw = r.take(size.checked_mul(4).ok_or(())?)?;
        let data: Vec<f32> = raw.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
        if data.iter().any(|v| !v.is_finite()) || weights.insert(name, Tensor { dims, data }).is_some() { return Err(()); }
    }
    if r.cursor != bytes.len() { return Err(()); }
    Ok(weights)
}

fn tensor(w: &mut Weights, name: &str, len: usize) -> Result<Vec<f32>, ()> {
    let t = w.remove(name).ok_or(())?;
    if t.data.len() != len { return Err(()); }
    Ok(t.data)
}

// Four independent accumulators allow SIMD without changing precision to f64.
// We deliberately avoid relaxed SIMD / fused multiply-add for portable parity.
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len());
    #[cfg(target_arch = "wasm32")]
    unsafe {
        use std::arch::wasm32::*;
        let mut sum = f32x4_splat(0.0);
        let mut i = 0;
        while i + 4 <= a.len() {
            sum = f32x4_add(sum, f32x4_mul(v128_load(a.as_ptr().add(i) as *const v128), v128_load(b.as_ptr().add(i) as *const v128)));
            i += 4;
        }
        let mut total = (f32x4_extract_lane::<0>(sum) + f32x4_extract_lane::<1>(sum)) + (f32x4_extract_lane::<2>(sum) + f32x4_extract_lane::<3>(sum));
        while i < a.len() { total += a[i] * b[i]; i += 1; }
        total
    }
    #[cfg(not(target_arch = "wasm32"))]
    { a.iter().zip(b).map(|(a, b)| a * b).sum() }
}

struct Linear { rows: usize, cols: usize, weight: Vec<f32>, bias: Option<Vec<f32>> }
impl Linear {
    fn load(w: &mut Weights, name: &str) -> Result<Self, ()> {
        let t = w.remove(&format!("{name}.weight")).ok_or(())?;
        if t.dims.len() != 2 { return Err(()); }
        let (rows, cols) = (t.dims[0], t.dims[1]);
        let bias = w.remove(&format!("{name}.bias")).map(|b| b.data);
        if bias.as_ref().is_some_and(|b| b.len() != rows) { return Err(()); }
        Ok(Self { rows, cols, weight: t.data, bias })
    }
    #[inline]
    fn run(&self, x: &[f32]) -> Vec<f32> {
        assert_eq!(self.cols, x.len());
        let mut out = Vec::with_capacity(self.rows);
        for (row, w) in self.weight.chunks_exact(self.cols).enumerate() {
            out.push(dot(w, x) + self.bias.as_ref().map_or(0.0, |b| b[row]));
        }
        out
    }
}

struct Norm { weight: Vec<f32>, bias: Vec<f32> }
impl Norm {
    fn load(w: &mut Weights, name: &str, size: usize) -> Result<Self, ()> {
        Ok(Self { weight: tensor(w, &format!("{name}.weight"), size)?, bias: tensor(w, &format!("{name}.bias"), size)? })
    }
    fn run(&self, x: &[f32], groups: usize, eps: f32) -> Vec<f32> {
        let mut out = vec![0.0; x.len()];
        let width = x.len() / groups;
        for g in 0..groups {
            let offset = g * width;
            let values = &x[offset..offset + width];
            let mean = values.iter().sum::<f32>() / width as f32;
            let variance = values.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / width as f32;
            let scale = (variance + eps).sqrt();
            for j in 0..width { out[offset+j] = (values[j]-mean) / scale * self.weight[offset+j] + self.bias[offset+j]; }
        }
        out
    }
}

#[inline] fn sigmoid(x: f32) -> f32 { 1.0 / (1.0 + (-x).exp()) }
#[inline] fn lerp(start: f32, end: f32, weight: f32) -> f32 {
    if weight.abs() < 0.5 { start + weight * (end-start) } else { end - (end-start) * (1.0-weight) }
}
fn sigmoid_vec(mut x: Vec<f32>) -> Vec<f32> { x.iter_mut().for_each(|x| *x = sigmoid(*x)); x }
fn relu(mut x: Vec<f32>) -> Vec<f32> { x.iter_mut().for_each(|x| *x = x.max(0.0)); x }
fn silu(mut x: Vec<f32>) -> Vec<f32> { x.iter_mut().for_each(|x| *x *= sigmoid(*x)); x }

struct TimeMixer {
    norm: Norm, lerps: Vec<f32>, wr: Linear, wk: Linear, wv: Linear, wo: Linear,
    kscale: Linear, vscale: Linear, va: Linear, vb: Linear, aa: Linear, ab: Linear,
    ga: Linear, gb: Linear, da: Linear, db: Linear, out_norm: Norm, bonus: Vec<f32>,
}
impl TimeMixer {
    fn load(w: &mut Weights, p: &str) -> Result<Self, ()> {
        Ok(Self {
            norm: Norm::load(w, &format!("{p}.layer_norm"), D)?,
            lerps: tensor(w, &format!("{p}.rkvdag_lerp"), D*8)?,
            wr: Linear::load(w, &format!("{p}.W_r"))?, wk: Linear::load(w, &format!("{p}.W_k"))?,
            wv: Linear::load(w, &format!("{p}.W_v"))?, wo: Linear::load(w, &format!("{p}.W_o"))?,
            kscale: Linear::load(w, &format!("{p}.k_scale_linear"))?, vscale: Linear::load(w, &format!("{p}.v_scale_linear"))?,
            va: Linear::load(w, &format!("{p}.v_lora_simple.A"))?, vb: Linear::load(w, &format!("{p}.v_lora_simple.B_and_lamb"))?,
            aa: Linear::load(w, &format!("{p}.a_lora_simple.A"))?, ab: Linear::load(w, &format!("{p}.a_lora_simple.B_and_lamb"))?,
            ga: Linear::load(w, &format!("{p}.lora_A_g"))?, gb: Linear::load(w, &format!("{p}.lora_B_g"))?,
            da: Linear::load(w, &format!("{p}.d_lora_mlp.A"))?, db: Linear::load(w, &format!("{p}.d_lora_mlp.B_and_lamb"))?,
            out_norm: Norm::load(w, &format!("{p}.out_group_norm"), D)?, bonus: tensor(w, &format!("{p}.bonus"), D)?,
        })
    }
    fn run(&self, x: Vec<f32>, v0: &mut Vec<f32>, first: bool, old: Option<&LayerState>) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
        let xl = self.norm.run(&x, 1, 1e-5);
        let shift = old.map_or(xl.as_slice(), |s| &s.shift);
        let mut mixed = Vec::with_capacity(8);
        for weights in self.lerps.chunks_exact(D) {
            mixed.push((0..D).map(|j| lerp(xl[j], shift[j], weights[j])).collect::<Vec<f32>>());
        }
        let r = self.wr.run(&mixed[0]);
        let k = self.wk.run(&mixed[1]);
        let mut v = self.wv.run(&mixed[2]);
        if first { *v0 = v.clone(); }
        else {
            let mix = sigmoid_vec(self.vb.run(&self.va.run(&mixed[2])));
            for j in 0..D { v[j] = lerp(v[j], v0[j], mix[j]); }
        }
        let a = sigmoid_vec(self.ab.run(&self.aa.run(&mixed[4])));
        let g = self.gb.run(&sigmoid_vec(self.ga.run(&mixed[5])));
        let mut decay_hidden = self.da.run(&mixed[3]);
        decay_hidden.iter_mut().for_each(|v| *v = v.tanh());
        let mut w = self.db.run(&decay_hidden);
        for v in &mut w {
            let s = -*v;
            let softplus = if s > 20.0 { s } else { s.exp().ln_1p() };
            *v = (-(-0.5 - softplus).exp()).exp();
        }
        let kscale = sigmoid_vec(self.kscale.run(&mixed[6]));
        let vscale = sigmoid_vec(self.vscale.run(&mixed[7]));
        let mut kk = vec![0.0; D];
        let mut vv = vec![0.0; D];
        let mut kb = vec![0.0; D];
        for h in 0..HEADS {
            let begin = h*K;
            let knorm = k[begin..begin+K].iter().map(|v| v*v).sum::<f32>().sqrt().max(1e-12);
            let vnorm = v[begin..begin+K].iter().map(|v| v*v).sum::<f32>().sqrt().max(1e-12);
            for j in begin..begin+K {
                kk[j] = kscale[h] * (k[j] / knorm);
                vv[j] = vscale[h] * (v[j] / vnorm);
                kb[j] = kk[j]*a[j];
            }
        }
        let previous = old.map(|s| s.matrix.decode());
        let mut matrix = vec![0.0; HEADS*K*K];
        let mut out = vec![0.0; D];
        for h in 0..HEADS {
            let begin = h*K;
            for row in 0..K {
                let offset = (h*K+row)*K;
                let sk = previous.as_ref().map_or(0.0, |s| dot(&s[offset..offset+K], &kk[begin..begin+K]));
                for col in 0..K {
                    let prior = previous.as_ref().map_or(0.0, |s| s[offset+col]);
                    matrix[offset+col] = prior*w[begin+col] - sk*kb[begin+col] + vv[begin+row]*kb[begin+col];
                }
                out[begin+row] = dot(&matrix[offset..offset+K], &r[begin..begin+K]);
            }
        }
        out = self.out_norm.run(&out, HEADS, 0.00064);
        for h in 0..HEADS {
            let begin = h*K;
            let bonus: f32 = (begin..begin+K).map(|j| r[j]*self.bonus[j]*kb[j]).sum();
            for j in begin..begin+K { out[j] = g[j] * (out[j] + bonus*vv[j]); }
        }
        let mut result = self.wo.run(&out);
        for j in 0..D { result[j] += x[j]; }
        (result, xl, matrix)
    }
}

struct ChannelMixer { norm: Norm, lerps: Vec<f32>, wk: Linear, wv: Linear }
impl ChannelMixer {
    fn load(w: &mut Weights, p: &str) -> Result<Self, ()> {
        Ok(Self { norm: Norm::load(w, &format!("{p}.layer_norm"), D)?, lerps: tensor(w, &format!("{p}.lerp_k"), D)?, wk: Linear::load(w, &format!("{p}.W_k"))?, wv: Linear::load(w, &format!("{p}.W_v"))? })
    }
    fn run(&self, x: Vec<f32>, old: Option<&LayerState>) -> (Vec<f32>, Vec<f32>) {
        let xl = self.norm.run(&x, 1, 1e-5);
        let shift = old.map_or(xl.as_slice(), |s| &s.channel_shift);
        let mix: Vec<f32> = (0..D).map(|j| lerp(xl[j], shift[j], self.lerps[j])).collect();
        let mut hidden = self.wk.run(&mix);
        for v in &mut hidden { *v = v.max(0.0).powi(2); }
        let mut out = self.wv.run(&hidden);
        for j in 0..D { out[j] += x[j]; }
        (out, xl)
    }
}

struct Layer { time: TimeMixer, channel: ChannelMixer }
enum Matrix { F32(Vec<f32>), Int8 { codes: Vec<i8>, scales: Vec<f32> } }
impl Matrix {
    fn store(values: Vec<f32>, compact: bool) -> Self {
        if !compact { return Self::F32(values); }
        let mut codes = Vec::with_capacity(values.len());
        let mut scales = Vec::with_capacity(values.len()/K);
        for row in values.chunks_exact(K) {
            let max = row.iter().map(|x| x.abs()).fold(0.0_f32, f32::max);
            let scale = if max > 0.0 { max/127.0 } else { 1.0 };
            scales.push(scale);
            codes.extend(row.iter().map(|v| (v/scale).round_ties_even().clamp(-127.0,127.0) as i8));
        }
        Self::Int8 { codes, scales }
    }
    fn decode(&self) -> Vec<f32> {
        match self {
            Self::F32(values) => values.clone(),
            Self::Int8 { codes, scales } => codes.iter().enumerate().map(|(j,v)| *v as f32 * scales[j/K]).collect(),
        }
    }
    fn bytes(&self) -> usize { match self { Self::F32(v) => v.len()*4, Self::Int8 {codes,scales} => codes.len()+scales.len()*4 } }
}

// IEEE binary16 round-to-nearest, ties-to-even, then expand back to binary32.
// Shift vectors remain f32 in memory; their values match NumPy's f16 cache.
fn round_f16(value: f32) -> f32 {
    let bits = value.to_bits();
    let sign = bits & 0x8000_0000;
    let abs = bits & 0x7fff_ffff;
    if abs >= 0x4780_0000 { return f32::from_bits(sign | 0x7f80_0000); }
    if abs < 0x3300_0000 { return f32::from_bits(sign); }
    if abs < 0x3880_0000 {
        let exponent = (abs >> 23) as i32 - 127;
        let fraction = (abs & 0x7f_ffff) | 0x80_0000;
        let shift = (-exponent - 1) as u32;
        let mask = (1u32 << shift) - 1;
        let mut sub = fraction >> shift;
        let remainder = fraction & mask;
        let half = 1u32 << (shift-1);
        if remainder > half || (remainder == half && sub & 1 != 0) { sub += 1; }
        let out = sub as f32 * 2.0_f32.powi(-24);
        return if sign != 0 { -out } else { out };
    }
    let rounded = abs + 0xfff + ((abs >> 13) & 1);
    let out = rounded & !0x1fff;
    if out >= 0x4780_0000 { f32::from_bits(sign | 0x7f80_0000) } else { f32::from_bits(sign | out) }
}

struct LayerState { shift: Vec<f32>, channel_shift: Vec<f32>, matrix: Matrix }
type EntityState = Vec<LayerState>;
struct Model { features0: Linear, features_norm: Norm, features3: Linear, streams: Vec<Vec<Layer>>, norm: Norm, head: Linear, output: Linear }
impl Model {
    fn load(bytes: &[u8]) -> Result<Self, ()> {
        let mut w = read_weights(bytes)?;
        let features0 = Linear::load(&mut w, "features2card.0")?;
        let features_norm = Norm::load(&mut w, "features2card.2", 512)?;
        let features3 = Linear::load(&mut w, "features2card.3")?;
        let mut streams = Vec::with_capacity(5);
        for (s, depth) in DEPTHS.into_iter().enumerate() {
            let mut layers = Vec::with_capacity(depth);
            for l in 0..depth {
                let p = format!("rwkv_modules.{s}.blocks.{l}");
                layers.push(Layer { time: TimeMixer::load(&mut w, &format!("{p}.time_mixer"))?, channel: ChannelMixer::load(&mut w, &format!("{p}.channel_mixer"))? });
            }
            streams.push(layers);
        }
        Ok(Self { features0, features_norm, features3, streams, norm: Norm::load(&mut w,"prehead_norm",D)?, head: Linear::load(&mut w,"head_p.0")?, output: Linear::load(&mut w,"p_linear")? })
    }
}

pub struct Engine { model: Model, banks: [BTreeMap<u32,EntityState>;5], compact: bool }
impl Engine {
    fn new(bytes: &[u8], bits: u32) -> Result<Self, ()> {
        if bits != 0 && bits != 8 { return Err(()); }
        Ok(Self { model: Model::load(bytes)?, banks: std::array::from_fn(|_| BTreeMap::new()), compact: bits == 8 })
    }
    fn step(&mut self, features: &[f32], ids: [u32;5], commit: bool) -> Result<[f32;5], ()> {
        if features.len() != 92 || features.iter().any(|v| !v.is_finite()) { return Err(()); }
        let m = &self.model;
        let mut x = silu(m.features0.run(features));
        x = m.features_norm.run(&x, 1, 1e-5);
        x = silu(m.features3.run(&x));
        let mut pending = Vec::with_capacity(5);
        for (stream, layers) in m.streams.iter().enumerate() {
            let old = self.banks[stream].get(&ids[stream]);
            let mut states = Vec::with_capacity(layers.len());
            let mut v0 = Vec::new();
            for (index, layer) in layers.iter().enumerate() {
                let previous = old.map(|s| &s[index]);
                let (result, mut shift, matrix) = layer.time.run(x, &mut v0, index == 0, previous);
                let (result, mut channel_shift) = layer.channel.run(result, previous);
                x = result;
                if commit {
                    let compact = self.compact && (stream == 0 || stream == 2);
                    if compact {
                        shift.iter_mut().for_each(|v| *v = round_f16(*v));
                        channel_shift.iter_mut().for_each(|v| *v = round_f16(*v));
                    }
                    states.push(LayerState { shift, channel_shift, matrix: Matrix::store(matrix, compact) });
                }
            }
            if commit { pending.push(states); }
        }
        x = m.norm.run(&x,1,1e-5);
        let logits = m.output.run(&relu(m.head.run(&x)));
        if logits.len() != 4 || logits.iter().any(|v| !v.is_finite()) { return Err(()); }
        let max = logits.iter().copied().fold(f32::NEG_INFINITY,f32::max);
        let mut probabilities: Vec<f32> = logits.into_iter().map(|v| (v-max).exp()).collect();
        let sum: f32 = probabilities.iter().sum();
        probabilities.iter_mut().for_each(|v| *v /= sum);
        if commit {
            for (bank, state) in pending.into_iter().enumerate() { self.banks[bank].insert(ids[bank], state); }
        }
        Ok([(1.0-probabilities[0]).clamp(1e-5,1.0-1e-5), probabilities[0], probabilities[1], probabilities[2], probabilities[3]])
    }
}

#[no_mangle]
pub extern "C" fn rwkv_alloc(size: usize) -> *mut u8 {
    let mut data = vec![0u8; size].into_boxed_slice();
    let p = data.as_mut_ptr();
    std::mem::forget(data);
    p
}

#[no_mangle]
pub unsafe extern "C" fn rwkv_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() { drop(Box::from_raw(slice::from_raw_parts_mut(ptr, size))); }
}

#[no_mangle]
pub unsafe extern "C" fn rwkv_create(ptr: *const u8, size: usize, state_bits: u32) -> *mut Engine {
    match Engine::new(slice::from_raw_parts(ptr,size), state_bits) { Ok(engine) => Box::into_raw(Box::new(engine)), Err(_) => std::ptr::null_mut() }
}

#[no_mangle]
pub unsafe extern "C" fn rwkv_drop(engine: *mut Engine) { if !engine.is_null() { drop(Box::from_raw(engine)); } }

#[no_mangle]
pub unsafe extern "C" fn rwkv_reset(engine: *mut Engine) { if let Some(engine) = engine.as_mut() { for bank in &mut engine.banks { bank.clear(); } } }

#[no_mangle]
pub unsafe extern "C" fn rwkv_step(engine: *mut Engine, features: *const f32, ids: *const u32, commit: u32, output: *mut f32) -> u32 {
    let Some(engine) = engine.as_mut() else { return 0; };
    let ids: [u32;5] = slice::from_raw_parts(ids,5).try_into().unwrap();
    match engine.step(slice::from_raw_parts(features,92),ids,commit != 0) {
        Ok(result) => { slice::from_raw_parts_mut(output,5).copy_from_slice(&result); 1 },
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn rwkv_state_bytes(engine: *const Engine) -> usize {
    engine.as_ref().map_or(0, |e| e.banks.iter().flat_map(|b| b.values()).flat_map(|s| s.iter()).map(|s| (s.shift.len()+s.channel_shift.len())*4+s.matrix.bytes()).sum())
}
