// Read-only, sampled pixel QA. It validates the actual staged images,
// not merely the fixture DOM or the capture engine's success response.
// Decode one image part at a time and allocate only a small sampling canvas.
(() => {
  const MAX_PARTS = 80;
  function rgb(value) {
    const match = /^rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(value);
    return match ? match.slice(1,4).map(Number) : null;
  }
  function region(image, start, scale, rect, width=100, height=34) {
    const x = Math.max(0, Math.floor(rect.left * scale));
    const y = Math.max(0, Math.floor(rect.top * scale - start));
    const w = Math.max(1, Math.min(image.naturalWidth - x, Math.ceil(rect.width * scale)));
    const h = Math.max(1, Math.min(image.naturalHeight - y, Math.ceil(rect.height * scale)));
    if (w < 1 || h < 1 || y + h > image.naturalHeight) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(width,w);
    canvas.height = Math.min(height,h);
    const ctx = canvas.getContext("2d", { willReadFrequently:true });
    if (!ctx) return null;
    ctx.drawImage(image,x,y,w,h,0,0,canvas.width,canvas.height);
    const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    canvas.width = 0;
    canvas.height = 0;
    return data;
  }
  function inkCount(data, light=false) {
    if (!data) return 0;
    let count = 0;
    for (let i=0;i<data.length;i+=4) {
      const r=data[i],g=data[i+1],b=data[i+2];
      if (light ? (r>190 && g>190 && b>190) :
        (r<105 && g<105 && b<115)) count+=1;
    }
    return count;
  }
  async function decode(dataUrl) {
    return new Promise((resolve,reject)=>{
      const image = new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error("Captured image could not be decoded."));
      image.src=dataUrl;
    });
  }
  function sample(image,x,y) {
    const canvas=document.createElement("canvas");
    canvas.width=1;canvas.height=1;
    const context=canvas.getContext("2d",{willReadFrequently:true});
    context.drawImage(image,x,y,1,1,0,0,1,1);
    const pixel=context.getImageData(0,0,1,1).data;
    canvas.width=0;canvas.height=0;
    return [pixel[0],pixel[1],pixel[2]];
  }
  async function check({parts,exportId,scenario,mode,format}) {
    if (!Number.isInteger(parts)||parts<1||parts>MAX_PARTS) {
      throw new Error("Invalid staged part count.");
    }
    const failures=[];
    const zones=[...document.querySelectorAll("#zones>.zone")];
    const finish=document.querySelector("#finish-marker strong");
    if (!finish || !zones.length) throw new Error("Fixture DOM not ready.");
    const scrollY=window.scrollY;
    const expected=zones.map((zone,index)=>{
      const rectangle=zone.getBoundingClientRect();
      const heading=zone.querySelector(".zone-number strong")?.getBoundingClientRect();
      const img=zone.querySelector(".lazy-box img");
      return {
        number:index+1,
        top:rectangle.top+scrollY,height:rectangle.height,
        left:rectangle.left,
        background:rgb(globalThis.getComputedStyle(zone).backgroundColor),
        heading:heading&&{
          left:heading.left,top:heading.top+scrollY,
          width:heading.width,height:heading.height,
        },
        lazyLoaded:scenario!=="lazy" || Boolean(img?.complete&&
          img.naturalWidth&&img.src.startsWith("data:image/svg+xml")),
      };
    });
    if (zones.some((zone,i)=>Number(zone.dataset.zone)!==i+1)) {
      failures.push("Fixture zone sequence is incorrect.");
    }
    let offset=0,scale=null;
    let checkedZones=0,checkedHeadings=0;
    let checkedFinish=false;
    const seen=new Set();
    const finishRect=finish.getBoundingClientRect();
    const finishTop=finishRect.top+scrollY;
    for (let i=1;i<=parts;i++) {
      const response=await browser.runtime.sendMessage({
        scope:"longpage-snap",type:"read",exportId,index:i,
      });
      if (typeof response?.image!=="string"||
          !response.image.startsWith("data:image/")) {
        failures.push("Part "+i+" is missing."); continue;
      }
      if (!response.image.startsWith("data:image/"+format)) {
        // JPEG MIME is image/jpeg; PNG/WebP are exact.
        failures.push("Part "+i+" is not "+format+".");
      }
      const image=await decode(response.image);
      if (!image.naturalWidth||!image.naturalHeight) {
        failures.push("Part "+i+" has invalid dimensions.");
        continue;
      }
      if (scale===null) scale=image.naturalWidth/document.documentElement.clientWidth;
      if (Math.abs(image.naturalWidth/document.documentElement.clientWidth-scale)>0.03) {
        failures.push("Part "+i+" differs in output scale.");
      }
      const end=offset+image.naturalHeight;
      for (const zone of expected) {
        if (seen.has(zone.number) || !zone.heading) continue;
        const headingY=(zone.heading.top+zone.heading.height/2)*scale;
        if (headingY<offset||headingY>=end) continue;
        seen.add(zone.number);
        const headingPixels=region(image,offset,scale,zone.heading);
        const count=inkCount(headingPixels);
        if (count<8) failures.push("ZONE "+String(zone.number).padStart(2,"0")+
          ": heading pixels missing at capture seam.");
        else checkedHeadings++;
        const y=Math.floor((zone.top+zone.height*0.66)*scale-offset);
        const x=Math.floor((zone.left+12)*scale);
        if (y>=0&&y<image.naturalHeight&&x>=0&&x<image.naturalWidth&&zone.background) {
          const actual=sample(image,x,y);
          const difference=actual.reduce((sum,channel,k)=>
            sum+Math.abs(channel-zone.background[k]),0)/3;
          if (difference>48) failures.push("ZONE "+zone.number+
            ": unexpected color or missing image content.");
          else checkedZones++;
        }
        if (!zone.lazyLoaded) failures.push("ZONE "+zone.number+
          ": lazy image did not load.");
      }
      const finishCenter=(finishTop+finishRect.height/2)*scale;
      if (!checkedFinish&&finishCenter>=offset&&finishCenter<end) {
        const pixels=region(image,offset,scale,{
          left:finishRect.left,top:finishTop,
          width:finishRect.width,height:finishRect.height,
        });
        checkedFinish=inkCount(pixels,true)>12;
      }
      offset=end;
      image.src="";
    }
    if (seen.size!==expected.length) failures.push("Only "+seen.size+
      " of "+expected.length+" zone headings were sampled.");
    if (checkedZones!==expected.length) failures.push("Only "+checkedZones+
      " of "+expected.length+" zone colors verified.");
    if (!checkedFinish) failures.push("FINISH title not detected in image pixels.");
    if (mode==="single"&&parts!==1) failures.push("Single mode produced multiple images.");
    if (mode==="split"&&parts<2) failures.push("Split fixture produced fewer than 2 parts.");
    return {
      status:failures.length?"fail":"pass", parts, zoneCount:expected.length,
      checkedZones,checkedHeadings,finishDetected:checkedFinish,failures,
    };
  }
  globalThis.LongPageSnapQaVisual=Object.freeze({check,rgb,inkCount});
})();
