import {FilesetResolver, ImageSegmenter} from '@mediapipe/tasks-vision';

let segmenter, loading;
const input=document.createElement('canvas'), mask=document.createElement('canvas');
const inputCtx=input.getContext('2d'), maskCtx=mask.getContext('2d');
let lastKey=null;
async function ready(){
  if(segmenter)return;
  if(!loading)loading=(async()=>{
    const files=await FilesetResolver.forVisionTasks('/static/vision/wasm');
    segmenter=await ImageSegmenter.createFromOptions(files,{
      baseOptions:{modelAssetPath:'/static/vision/selfie_segmenter.tflite',delegate:'CPU'},
      runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false
    });
  })().catch(e=>{loading=null;throw e;});
  await loading;
}
function generate(source,key){
  if(!segmenter)throw Error('Person segmentation is not ready');
  if(key===lastKey)return mask;
  const scale=Math.min(1,384/Math.max(source.width,source.height));
  input.width=Math.max(1,Math.round(source.width*scale));
  input.height=Math.max(1,Math.round(source.height*scale));
  inputCtx.drawImage(source,0,0,input.width,input.height);
  segmenter.segment(input,result=>{
    const confidence=result.confidenceMasks?.[0];
    if(!confidence)throw Error('Person mask unavailable');
    mask.width=confidence.width;mask.height=confidence.height;
    const pixels=maskCtx.createImageData(mask.width,mask.height), values=confidence.getAsFloat32Array();
    for(let i=0;i<values.length;i++){
      const a=Math.max(0,Math.min(1,(values[i]-.35)/.4));
      pixels.data[i*4+3]=Math.round(a*255);
    }
    maskCtx.putImageData(pixels,0,0);
  });
  lastKey=key;return mask;
}
window.PersonMask={ready,generate,isReady:()=>!!segmenter,reset:()=>{lastKey=null;}};
