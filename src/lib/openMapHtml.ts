import { mapJson, type OpenMapState } from './openMap';
import { arcgisApiKey, type MapType } from './mapModel';
import { avatarPlaceholderSvg } from './avatars';

const arcgisImageryService = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';

// A small custom vector style, using real OpenMapTiles data rather than a decorative image.
export const midnightStyle = {
  version: 8,
  name: 'Closeby Midnight',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { streets: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#101625' } },
    { id: 'neighborhoods', type: 'fill', source: 'streets', 'source-layer': 'landuse', paint: { 'fill-color': '#151c30', 'fill-opacity': .7 } },
    { id: 'landcover', type: 'fill', source: 'streets', 'source-layer': 'landcover', paint: { 'fill-color': '#121a2b', 'fill-opacity': .65 } },
    { id: 'parks', type: 'fill', source: 'streets', 'source-layer': 'park', paint: { 'fill-color': '#131d30' } },
    { id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': '#0b101c' } },
    { id: 'waterways', type: 'line', source: 'streets', 'source-layer': 'waterway', paint: { 'line-color': '#0b101c', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .5, 17, 5] } },
    { id: 'buildings', type: 'fill', source: 'streets', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#1a2237', 'fill-opacity': .6, 'fill-outline-color': '#242d44' } },
    { id: 'paths', type: 'line', source: 'streets', 'source-layer': 'transportation', filter: ['in', 'class', 'path', 'track', 'pedestrian'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#27324a', 'line-opacity': .65, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, .4, 18, 1.2], 'line-dasharray': [2, 3] } },
    { id: 'streets', type: 'line', source: 'streets', 'source-layer': 'transportation', filter: ['in', 'class', 'minor', 'service', 'tertiary'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2b354f', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, .3, 14, .8, 18, 2.2] } },
    { id: 'main-roads', type: 'line', source: 'streets', 'source-layer': 'transportation', filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#45506b', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, .4, 12, 1.1, 18, 3.5] } },
    { id: 'rail', type: 'line', source: 'streets', 'source-layer': 'transportation', filter: ['in', 'class', 'rail', 'transit'], paint: { 'line-color': '#344059', 'line-width': 1, 'line-dasharray': [2, 3] } },
    { id: 'boundaries', type: 'line', source: 'streets', 'source-layer': 'boundary', paint: { 'line-color': '#5362a1', 'line-opacity': .4, 'line-width': .8, 'line-dasharray': [2, 4] } },
    { id: 'road-names', type: 'symbol', source: 'streets', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'symbol-spacing': 380 }, paint: { 'text-color': '#8390b0', 'text-halo-color': '#101625', 'text-halo-width': 2 } },
    { id: 'place-names', type: 'symbol', source: 'streets', 'source-layer': 'place', layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 12, 13, 18, 15], 'text-transform': 'uppercase', 'text-letter-spacing': .14, 'text-padding': 16 }, paint: { 'text-color': '#8998bd', 'text-halo-color': '#101625', 'text-halo-width': 2 } },
  ],
};

// The 2016–17 mosaic is CC BY 4.0. Newer EOX mosaics have different terms.
export function openMapStyle(type: MapType, apiKey = arcgisApiKey) {
  if (type === 'dark') return midnightStyle;
  if (type === 'standard') {
    const palette: Record<string, string> = {
      '#101625': '#F3F1E9', '#151c30': '#E9E6DC', '#121a2b': '#E3E9DA', '#131d30': '#CDE1C3',
      '#0b101c': '#AAD4E5', '#1a2237': '#D9D5CC', '#242d44': '#C4BFB4', '#27324a': '#B9AD99',
      '#2b354f': '#FFFFFF', '#45506b': '#D7AB70', '#344059': '#9E9690', '#5362a1': '#A08AA4',
      '#8390b0': '#686454', '#8998bd': '#4C5849',
    };
    return JSON.parse(JSON.stringify(midnightStyle).replace(/#[0-9a-f]{6}/gi, color => palette[color] ?? color));
  }
  const terrain = type === 'terrain';
  const arcgis = !terrain && Boolean(apiKey);
  const overlay = type !== 'satellite';
  return {
    version: 8, name: terrain ? 'Closeby Terrain' : 'Closeby Satellite', glyphs: midnightStyle.glyphs,
    sources: {
      imagery: { type: 'raster', tiles: [arcgis
        ? `${arcgisImageryService}/tile/{z}/{y}/{x}?token=${encodeURIComponent(apiKey)}`
        : `https://tiles.maps.eox.at/wmts/1.0.0/${terrain ? 'terrain_3857' : 's2cloudless_3857'}/default/g/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: terrain ? 13 : arcgis ? 19 : 14 },
      ...(overlay ? midnightStyle.sources : {}),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#182126' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
      ...(overlay ? midnightStyle.layers.filter(layer => ['streets', 'main-roads', 'boundaries', 'road-names', 'place-names'].includes(layer.id)).map(layer => ({
        ...layer,
        paint: Object.fromEntries(Object.entries(layer.paint).map(([key, value]) => [key, key === 'line-color' ? (terrain ? '#8F7455' : '#E8D4A6') : key === 'text-color' ? (terrain ? '#293F39' : '#FFFFFF') : key === 'text-halo-color' ? (terrain ? '#F6F1DC' : '#182126') : value])),
      })) : []),
    ],
  };
}

export function mapAttribution(type: MapType, apiKey = arcgisApiKey): string {
  const streets = '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
  if (type === 'dark' || type === 'standard') return streets;
  if (type === 'terrain') return 'Terrain: Rendering © <a href="https://maps.eox.at/" target="_blank" rel="noopener noreferrer">EOX</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> &amp; <a href="https://maps.eox.at/#data" target="_blank" rel="noopener noreferrer">others</a><br>' + streets;
  if (apiKey) return 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> · <span id="imagery-credit">Esri, Maxar, Earthstar Geographics, and the GIS User Community</span>' + (type === 'hybrid' ? '<br>' + streets : '');
  const satellite = '<a href="https://s2maps.eu/" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless</a> by <a href="https://eox.at/" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a><br>Contains modified Copernicus Sentinel data 2016 &amp; 2017 · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · <a href="https://maps.eox.at/" target="_blank" rel="noopener noreferrer">EOX::Maps</a>';
  return satellite + (type === 'hybrid' ? '<br>' + streets : '');
}

export function openMapHtml(channel: string, initial: OpenMapState, apiKey = arcgisApiKey): string {
  const arcgis = Boolean(apiKey) && (initial.mapType === 'satellite' || initial.mapType === 'hybrid');
  const imageryMetadata = arcgis ? `${arcgisImageryService}?f=json&token=${encodeURIComponent(apiKey)}` : null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src https://tiles.openfreemap.org https://tiles.maps.eox.at https://ibasemaps-api.arcgis.com; img-src data: blob: https: http:; worker-src blob:; font-src data:;">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<style>
html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#101625;font-family:system-ui,-apple-system,sans-serif}
.attribution{position:absolute;bottom:0;right:0;max-width:calc(100% - 14px);z-index:5;background:#0b101cf2;color:#acb8d3;font-size:10px;line-height:14px;padding:3px 7px;border-radius:5px 0 0 0}
.attribution a{color:#c0cae0;text-decoration:none}.attribution a:focus-visible{text-decoration:underline;outline:1px solid #8298ff}
.pin{position:relative;border:0;background:none;padding:3px 2px 0;width:64px;height:73px;cursor:pointer;overflow:visible;color:#E9F1FC;filter:drop-shadow(0 3px 8px #0008)}
.pin .face{display:block;position:relative;box-sizing:border-box;width:60px;height:60px;border:3px solid currentColor;border-radius:50%;overflow:hidden;background:#25394F url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarPlaceholderSvg)}") center/cover}
.pin .face img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%}
.pin .pointer{display:block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid currentColor;margin:-1px auto 0}
.pin.selected{color:#93A7FF}.pin.stale{opacity:.55}
.pin .dot{position:absolute;width:9px;height:9px;border:2px solid #fff;border-radius:50%;right:4px;bottom:14px;background:#3EED95}
.pin.stale .dot{background:#8596A8}
.pin .battery{position:absolute;left:0;bottom:12px;min-width:34px;padding:2px 4px;border-radius:7px;border:1px solid #dde9f8;background:#0b1521;color:#4ddd86;font:700 9px system-ui;text-align:center}
.pin .arrival{position:absolute;left:62px;top:-52px;width:152px;padding:8px 9px;border-radius:13px 13px 13px 3px;border:1px solid #50779d;background:#0b1521;color:#f2f6fe;font:500 10px/15px system-ui;text-align:left;white-space:pre-line;display:none;pointer-events:none}
.pin .label{position:absolute;left:69px;top:20px;padding:4px 7px;border-radius:5px;background:#101625e8;color:#a7b8ff;border:1px solid #2d3959;font-size:10px;font-weight:600;max-width:110px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;pointer-events:none}
.pin.selected .label{color:#eef2ff;border-color:#566490}.pin:focus-visible{outline:2px solid #a6b6ff;border-radius:12px}
.pin.live .dot:before{content:'';position:absolute;inset:-5px;border:1px solid #8195ff;border-radius:50%;animation:pulse 2.4s ease-out infinite}
.zone-pin{max-width:190px;border:2px solid #1186ff;border-radius:13px;padding:8px 11px;background:#0b1521;color:#f2f6fe;white-space:pre-line;font:600 12px system-ui;text-align:center;cursor:pointer;box-shadow:0 3px 8px #0006}
@keyframes pulse{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.8);opacity:0}}
@media(prefers-reduced-motion:reduce){.pin.live .dot:before{animation:none}}
</style></head><body><div id="map" role="region" aria-label="Live GPS map"></div>
<div class="attribution">${mapAttribution(initial.mapType, apiKey)}</div>
<script>
(function(){
  const channel=${mapJson(channel)};
  const trackingZoom=${!arcgis && (initial.mapType === 'satellite' || initial.mapType === 'hybrid') || initial.mapType === 'terrain' ? 14 : 16};
  const imageryMetadata=${mapJson(imageryMetadata)};
  function send(message){message.channel=channel;if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));else window.parent.postMessage(message,'*');}
  window.closebyMapFailure=function(){send({type:'error',message:imageryMetadata?'ArcGIS imagery could not load. Check your API key, its expiration and basemap permissions, your usage allowance, and your connection.':'The map could not load. Check your internet connection and try again.'});};
  let state=${mapJson(initial)};
  let map,ready=false,centered=false,follow=true,previous=null,failed=false;
  const pins=new Map(),zonePins=new Map(),reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const empty=()=>({type:'FeatureCollection',features:[]});
  const xy=p=>[p.longitude,p.latitude];
  const fresh=fix=>Date.now()-fix.timestamp<=45000&&fix.timestamp<=Date.now()+5000;
  function polygon(center,radius,properties){
    const ring=[],lat=center.latitude*Math.PI/180,lon=center.longitude*Math.PI/180,angle=radius/6371008.8;
    for(let i=0;i<=64;i++){
      const bearing=i/64*Math.PI*2;
      const nextLat=Math.asin(Math.sin(lat)*Math.cos(angle)+Math.cos(lat)*Math.sin(angle)*Math.cos(bearing));
      const nextLon=lon+Math.atan2(Math.sin(bearing)*Math.sin(angle)*Math.cos(lat),Math.cos(angle)-Math.sin(lat)*Math.sin(nextLat));
      ring.push([((nextLon*180/Math.PI+540)%360)-180,nextLat*180/Math.PI]);
    }
    // Keep circles continuous across the antimeridian.
    for(let i=1;i<ring.length;i++){while(ring[i][0]-ring[i-1][0]>180)ring[i][0]-=360;while(ring[i][0]-ring[i-1][0]<-180)ring[i][0]+=360;}
    return {type:'Feature',properties,geometry:{type:'Polygon',coordinates:[ring]}};
  }
  function animatePin(pin,coordinate){
    if(pin.frame)cancelAnimationFrame(pin.frame);
    const from=pin.marker.getLngLat(),delta=((coordinate[0]-from.lng+540)%360)-180;
    if(reduced||Math.abs(delta)+Math.abs(coordinate[1]-from.lat)>.02){pin.marker.setLngLat(coordinate);return;}
    const started=performance.now();
    function step(now){const t=Math.min(1,(now-started)/650),k=t*t*(3-2*t);pin.marker.setLngLat([from.lng+delta*k,from.lat+(coordinate[1]-from.lat)*k]);if(t<1)pin.frame=requestAnimationFrame(step);else pin.frame=0;}
    pin.frame=requestAnimationFrame(step);
  }
  function apply(next){
    state=next;if(!ready)return;
    const height=map.getContainer().clientHeight,bottom=Math.min(state.bottomInset,height*.5);
    document.querySelector('.attribution').style.bottom=bottom+'px';
    map.setPadding({top:state.bottomInset?Math.min(115,height*.22):20,bottom:state.bottomInset?bottom+15:20,left:25,right:25});
    const ids=new Set(state.devices.map(d=>d.id));
    pins.forEach((pin,id)=>{if(!ids.has(id)){if(pin.frame)cancelAnimationFrame(pin.frame);pin.marker.remove();pins.delete(id);}});
    state.devices.forEach(device=>{
      let pin=pins.get(device.id);
      if(!pin){
        const node=document.createElement('button');node.type='button';
        node.innerHTML='<span class="face" aria-hidden="true"></span><span class="pointer" aria-hidden="true"></span><span class="dot" aria-hidden="true"></span><span class="label"></span><span class="battery"></span><span class="arrival"></span>';
        node.addEventListener('click',event=>{event.stopPropagation();send({type:'select',id:device.id});});
        pin={node,marker:new maplibregl.Marker({element:node,anchor:'bottom'}).setLngLat(xy(device.location)).addTo(map),fix:null,frame:0};pins.set(device.id,pin);
      }
      const selected=device.id===state.selectedId,isFresh=fresh(device.location);
      pin.node.className='pin'+(selected?' selected':'')+(isFresh?' live':' stale');
      pin.node.style.zIndex=selected?'3':'2';pin.node.setAttribute('aria-label',device.name+(isFresh?' — current GPS position':' — last known position'));
      pin.node.querySelector('.label').textContent=device.name;
      const battery=pin.node.querySelector('.battery');battery.textContent='▰ '+(device.batteryPercent===null?'—':device.batteryPercent+'%');battery.style.color=device.batteryPercent===null?'#91a6be':device.batteryPercent<=20?'#e7434f':'#4ddd86';
      const arrival=pin.node.querySelector('.arrival'),presence=device.presence;
      arrival.style.display=presence?'block':'none';
      if(presence){
        const minutes=Math.max(0,Math.floor((Date.now()-presence.since)/60000));
        const duration=minutes<1?'less than 1 min':minutes<60?minutes+' min':Math.floor(minutes/60)+' hr'+(minutes%60?' '+minutes%60+' min':'');
        const detail=Date.now()-presence.updatedAt<=45000?'Here for '+(presence.arrivalObserved?'':'at least ')+duration:'Last seen here';
        arrival.textContent=presence.name+'\\n'+detail+'\\n'+(presence.arrivalObserved?'Arrived ':'First seen ')+new Date(presence.since).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      }
      if(pin.portraitSource!==device.portraitSource){
        const face=pin.node.querySelector('.face');face.replaceChildren();
        if(device.portraitSource){
          const image=document.createElement('img');image.alt='';image.referrerPolicy='no-referrer';image.draggable=false;
          image.onerror=()=>image.remove();image.src=device.portraitSource;face.appendChild(image);
        }
        pin.portraitSource=device.portraitSource;
      }
      if(pin.fix&&(pin.fix.latitude!==device.location.latitude||pin.fix.longitude!==device.location.longitude))animatePin(pin,xy(device.location));
      pin.fix=device.location;
    });
    const lines=state.routes.map(segment=>segment.map(xy));
    for(const line of lines)for(let i=1;i<line.length;i++){while(line[i][0]-line[i-1][0]>180)line[i][0]-=360;while(line[i][0]-line[i-1][0]<-180)line[i][0]+=360;}
    map.getSource('route').setData({type:'FeatureCollection',features:lines.filter(line=>line.length>1).map(line=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:line}}))});
    map.getSource('endpoints').setData({type:'FeatureCollection',features:lines.filter(line=>line.length>1).flatMap(line=>[line[0],line[line.length-1]]).map(coordinates=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates}}))});
    const zoneIds=new Set(state.zones.map(zone=>zone.id));
    zonePins.forEach((pin,id)=>{if(!zoneIds.has(id)){pin.marker.remove();zonePins.delete(id);}});
    state.zones.forEach(zone=>{
      let pin=zonePins.get(zone.id);
      if(!pin){
        const node=document.createElement('button');node.type='button';node.className='zone-pin';
        node.addEventListener('click',event=>{event.stopPropagation();send({type:'selectZone',id:zone.id});});
        pin={node,marker:new maplibregl.Marker({element:node,anchor:'bottom'}).setLngLat(xy(zone.coordinate)).addTo(map)};zonePins.set(zone.id,pin);
      }
      pin.marker.setLngLat(xy(zone.coordinate));pin.node.textContent=zone.name+(zone.description?'\\n'+zone.description:'');
      pin.node.setAttribute('aria-label','Safe zone: '+zone.name);pin.node.style.borderColor=/^#[0-9a-f]{6}$/i.test(zone.color)?zone.color:'#1186ff';pin.node.style.opacity=zone.enabled?'1':'.65';
    });
    map.getSource('zones').setData({type:'FeatureCollection',features:state.showZoneBoundaries?state.zones.map(zone=>polygon(zone.coordinate,zone.radius,{color:/^#[0-9a-f]{6}$/i.test(zone.color)?zone.color:'#8295ff',enabled:zone.enabled})):[]});
    const measured=state.location;
    map.getSource('accuracy').setData({type:'FeatureCollection',features:measured&&Number.isFinite(measured.accuracy)&&measured.accuracy>0?[polygon(measured,Math.min(measured.accuracy,20000000),{})]:[]});
    const changed=!previous||previous.selectedId!==state.selectedId||previous.recenterKey!==state.recenterKey;
    if(changed)follow=true;
    const target=state.focusCoordinate||state.devices.find(d=>d.id===state.selectedId)?.location||measured||state.devices[0]?.location;
    const moved=!previous||previous.target?.latitude!==target?.latitude||previous.target?.longitude!==target?.longitude;
    if(target&&(!centered||changed||follow&&moved)){
      map.easeTo({center:xy(target),...(!centered?{zoom:trackingZoom}:{}),duration:centered&&!reduced?650:0});centered=true;
    }else if(!target&&state.bounds&&(!centered||changed||follow&&JSON.stringify(state.bounds)!==previous?.bounds)){
      const b=state.bounds,east=b.east<b.west?b.east+360:b.east;
      map.fitBounds([[b.west,b.south],[east,b.north]],{padding:45,maxZoom:16,duration:0});centered=true;
    }
    previous={selectedId:state.selectedId,recenterKey:state.recenterKey,target,bounds:JSON.stringify(state.bounds)};
  }
  function receive(event){
    if(!window.ReactNativeWebView&&event.source!==window.parent)return;
    try{const data=typeof event.data==='string'?JSON.parse(event.data):event.data;if(data?.channel===channel&&data.type==='update')apply(data.state);}catch{}
  }
  window.addEventListener('message',receive);document.addEventListener('message',receive);
  window.closebyUpdate=apply;
  window.closebyStart=async function(){
    try{
      if(imageryMetadata){
        const response=await fetch(imageryMetadata,{referrerPolicy:'no-referrer'});
        const metadata=await response.json();
        if(!response.ok||metadata.error||typeof metadata.copyrightText!=='string'||!metadata.copyrightText.trim()){window.closebyMapFailure();return;}
        // Provider text is remote data, never HTML. Fetch current source credits.
        document.getElementById('imagery-credit').textContent=metadata.copyrightText;
      }
      const first=state.devices.find(d=>d.id===state.selectedId)?.location||state.location||state.devices[0]?.location;
      map=new maplibregl.Map({container:'map',style:${mapJson(openMapStyle(initial.mapType, apiKey))},center:first?xy(first):[0,20],zoom:first?trackingZoom:2,maxZoom:19,attributionControl:false,renderWorldCopies:false,dragRotate:false,touchPitch:false,pitchWithRotate:false});
      map.touchZoomRotate.disableRotation();
      map.on('dragstart',()=>{follow=false;});map.on('zoomstart',event=>{if(event.originalEvent)follow=false;});
      map.on('click',event=>send({type:'press',coordinate:{latitude:event.lngLat.lat,longitude:((event.lngLat.lng+540)%360)-180}}));
      map.on('error',event=>{if(event.sourceId==='streets'||event.sourceId==='imagery'||!ready){failed=true;window.closebyMapFailure();}});
      map.on('load',()=>{
        for(const id of ['route','endpoints','zones','accuracy'])map.addSource(id,{type:'geojson',data:empty()});
        map.addLayer({id:'zone-fill',type:'fill',source:'zones',paint:{'fill-color':['get','color'],'fill-opacity':['case',['get','enabled'],.09,.025]}});
        map.addLayer({id:'zone-outline',type:'line',source:'zones',paint:{'line-color':['get','color'],'line-width':1.3,'line-opacity':.7,'line-dasharray':[2,3]}});
        map.addLayer({id:'accuracy-fill',type:'fill',source:'accuracy',paint:{'fill-color':'#7b8eff','fill-opacity':.075}});
        map.addLayer({id:'accuracy-outline',type:'line',source:'accuracy',paint:{'line-color':'#8a9cff','line-opacity':.35,'line-width':1}});
        map.addLayer({id:'route-glow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#8d9fff','line-width':9,'line-opacity':.18,'line-blur':4}});
        map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#eef2ff','line-width':3.5}});
        map.addLayer({id:'route-endpoints',type:'circle',source:'endpoints',paint:{'circle-radius':4,'circle-color':'#8094ff','circle-stroke-color':'#eef2ff','circle-stroke-width':2}});
        ready=true;apply(state);map.once('idle',()=>{if(!failed)send({type:'ready'});});
      });
      const timer=setInterval(()=>{if(ready)apply(state);},5000);
      const observer=new ResizeObserver(()=>{map.resize();if(ready)apply(state);});observer.observe(document.getElementById('map'));
      window.addEventListener('pagehide',()=>{clearInterval(timer);observer.disconnect();pins.forEach(pin=>{if(pin.frame)cancelAnimationFrame(pin.frame);});map.remove();},{once:true});
    }catch{window.closebyMapFailure();}
  };
})();
</script><script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js" onload="closebyStart()" onerror="closebyMapFailure()"></script></body></html>`;
}
