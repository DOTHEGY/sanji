import template from '../private/youtube-discovery/index.html';
import stylesheet from '../private/youtube-discovery/style.css';
import {mountYouTubeDiscoveryController} from './youtube-discovery.js';

/** Native panel, not a route iframe; the shell owns tab visibility and session lifetime. */
export function mountYouTubeDiscovery(root,{owner,signal,client}={}){
  if(!root?.ownerDocument||!owner||!client||signal?.aborted)return ()=>{};
  const document=root.ownerDocument;
  // Parse only the repository template, not provider data; never attach its script.
  const parsed=new document.defaultView.DOMParser().parseFromString(template,'text/html');
  const original=parsed.querySelector('body > main');
  if(!original)throw Error('YouTube discovery panel template missing');
  const main=document.importNode(original,true);
  // In the native view, workspace navigation is already present above the panel.
  main.querySelector('header > a[href="../"]')?.remove();
  const host=document.createElement('div');
  host.className='sanji-chewy-native-panel';
  const shadow=host.attachShadow({mode:'open'});
  const style=document.createElement('style');
  // Isolate existing ID-based style and duplicate ID/reference namespaces.
  style.textContent=':host{display:block}'+stylesheet.replace(/^:root\{/,':host{');
  shadow.append(style,main);
  root.append(host);
  let stop;
  function dispose(){
    signal?.removeEventListener('abort',dispose);
    try{stop?.();}finally{host.remove();}
  }
  try {
    stop=mountYouTubeDiscoveryController(shadow,{client,expectedOwner:owner,signal});
    signal?.addEventListener('abort',dispose,{once:true});
  } catch(error) { dispose(); throw error; }
  return dispose;
}
