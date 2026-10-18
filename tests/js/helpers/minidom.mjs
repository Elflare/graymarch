/** Minimal in-memory DOM for deterministic UI wiring tests.
 * No browser layout or visual correctness is claimed by this helper.
 */
class ClassList {
 constructor(el){this.el=el}
 has(c){return this.el.className.split(/\s+/).includes(c)}
 contains(c){return this.has(c)}
 add(...xs){this.el.className=[...new Set([...this.el.className.split(/\s+/).filter(Boolean),...xs])].join(' ')}
 remove(...xs){this.el.className=this.el.className.split(/\s+/).filter(x=>!xs.includes(x)).join(' ')}
 toggle(c,on){if(on===undefined)on=!this.has(c);on?this.add(c):this.remove(c);return on}
}
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.attributes={};this.dataset={};this.style={};this.className='';this.classList=new ClassList(this);this.disabled=false;this._text=''}
 setAttribute(k,v){v=String(v);this.attributes[k]=v;if(k==='class')this.className=v;if(k==='id')this.id=v;if(k==='disabled')this.disabled=true;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=v}
 getAttribute(k){return k==='class'?this.className:this.attributes[k]}
 appendChild(n){if(n.tagName==='#FRAGMENT'){for(const ch of [...n.childNodes])this.appendChild(ch);return n} n.remove();this.childNodes.push(n);n.parentNode=this;return n}
 insertBefore(n,b){if(n.tagName==='#FRAGMENT'){for(const ch of [...n.childNodes])this.insertBefore(ch,b);return n}n.remove();const i=this.childNodes.indexOf(b);this.childNodes.splice(i<0?this.childNodes.length:i,0,n);n.parentNode=this;return n}
 replaceChildren(...ns){this.childNodes.forEach(x=>x.parentNode=null);this.childNodes=[];this._text='';ns.forEach(n=>this.appendChild(n))}
 remove(){if(this.parentNode){const a=this.parentNode.childNodes;const i=a.indexOf(this);if(i>=0)a.splice(i,1);this.parentNode=null}}
 set innerHTML(v){this.replaceChildren();parseHTML(String(v),this)}
 get innerHTML(){return this._text+this.childNodes.map(n=>`<${n.tagName}>${n.innerHTML}</${n.tagName}>`).join('')}
 set textContent(v){this.replaceChildren();this._text=String(v)}
 get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('')}
 matches(sel){return sel.split(',').some(s=>{s=s.trim();const tag=s.match(/^[a-z][\w-]*/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;const id=s.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;const classes=[...s.matchAll(/\.([\w-]+)/g)].map(x=>x[1]);if(classes.some(c=>!this.classList.contains(c)))return false;for(const m of s.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)){if(this.attributes[m[1]]===undefined&&!m[1].startsWith('data-'))return false;let val=this.attributes[m[1]];if(m[1].startsWith('data-'))val=this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())];if(val===undefined)return false;if(m[2]!==undefined&&String(val)!==m[2])return false;}return true})}
 querySelectorAll(sel){const out=[];function walk(el){for(const n of el.childNodes){if(n.matches(sel))out.push(n);walk(n)}}walk(this);return out}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null}
 getAnimations(){return []}
 getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}
  animate(){return {cancel(){}}}
 addEventListener(type,fn){this.listeners??=new Map();if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
 removeEventListener(type,fn){this.listeners?.get(type)?.delete(fn)}
 dispatchEvent(event){for(const fn of this.listeners?.get(event.type)||[])fn(event);return true}
}
function parseHTML(html,parent){const stack=[parent];for(const m of html.matchAll(/<!--[^]*?-->|<![^>]*>|<\/([\w-]+)[^>]*>|<([\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)){if(m[1]){let i=stack.length-1;while(i>0&&stack[i].tagName!==m[1].toUpperCase())i--;if(i>0)stack.length=i;}else if(m[2]){const el=new Element(m[2]);for(const a of m[3].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))el.setAttribute(a[1],a[2]??a[3]??a[4]??'');stack.at(-1).appendChild(el);if(!['META','LINK','INPUT','BR','HR','IMG','SOURCE'].includes(el.tagName)&&!m[3].endsWith('/'))stack.push(el);}else if(m[4])stack.at(-1)._text+=m[4]}}

export function createDOM(html) {
  const document = new Element('document');
  parseHTML(html, document);
  document.getElementById = id => document.querySelector('#' + id);
  document.createElement = tag => new Element(tag);
  document.createDocumentFragment = () => new Element('#fragment');
  document.body = document.querySelector('body');
  return document;
}
