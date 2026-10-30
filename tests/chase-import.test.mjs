import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChaseImportPayload, ChaseImportExport } from '../module/chase/importer.js';
import { ChaseTracker } from '../module/chase/tracker.js';

const event = {name:' Rooftops ',obstacles:[{name:'Gap',requiredPoints:4,resolutionMode:'individual'}],opportunities:[{name:'Shortcut'}]};
function setup({fail=false}={}) {
  const writes=[];
  globalThis.game={user:{isGM:true},settings:{async set(m,k,data){if(fail)throw Error('storage failed');writes.push(structuredClone(data));}},i18n:{localize:k=>k,format:k=>k}};
  globalThis.Hooks={callAll(){}};
  const tracker=new ChaseTracker({moduleId:'test',settingKey:'chase'});
  tracker.state={events:[{id:'existing',name:'Existing'}],log:[{message:'Keep'}]};
  return {tracker,writes};
}

test('accepts single event, array and events envelope; validates entire payload',()=>{
  for(const payload of [event,[event],{events:[event]}]){
    const [result]=sanitizeChaseImportPayload(payload);
    assert.equal(result.name,'Rooftops');assert.equal(result.obstacles[0].resolutionMode,'individual');
  }
  for(const payload of [null,[],{events:'bad'},[event,null],{name:' '},{name:'x',obstacles:{}},{name:'x',opportunities:[{}]}, {name:'x',obstacles:[{name:'x',requiredPoints:-1}]},{name:'x',obstacles:[{name:'x',requiredPoints:Infinity}]},{name:'x',obstacles:[{name:'x',resolutionMode:'invalid'}]}])assert.throws(()=>sanitizeChaseImportPayload(payload));
});

test('appends complete fresh events in one write and preserves existing state',async()=>{
  const {tracker,writes}=setup();
  const [created]=await tracker.importEvents([{...event,id:'existing',obstacles:[{...event.obstacles[0],id:'old',progress:4,revealed:true,assignedActors:[{uuid:'Actor.a'}]}]},event]);
  assert.equal(writes.length,1);assert.equal(tracker.getEvents().length,3);
  assert.deepEqual(tracker.state.log,[{message:'Keep'}]);assert.equal(tracker.state.events[0].id,'existing');
  assert.notEqual(created.id,'existing');assert.notEqual(created.id,tracker.state.events[2].id);
  const obstacle=created.obstacles[0];assert.notEqual(obstacle.id,'old');assert.equal(obstacle.requiredPoints,4);assert.equal(obstacle.progress,0);assert.equal(obstacle.revealed,false);assert.deepEqual(obstacle.assignedActors,[]);assert.deepEqual(obstacle.individualProgress,[]);
  assert.equal(created.opportunities[0].name,'Shortcut');assert.equal(created.opportunities[0].revealed,false);
  created.name='Changed';assert.equal(tracker.state.events[1].name,'Rooftops');
});

test('invalid data, player access and storage failure leave state unchanged',async()=>{
  for(const kind of ['invalid','permission','storage']){
    const {tracker,writes}=setup({fail:kind==='storage'});const before=structuredClone(tracker.state);
    if(kind==='permission')game.user.isGM=false;
    await assert.rejects(tracker.importEvents(kind==='invalid'?[event,null]:event));
    assert.deepEqual(tracker.state,before);assert.equal(writes.length,0);
  }
});

test('file dialog imports valid JSON, handles cancel and malformed files',async()=>{
  for(const kind of ['valid','cancel','json','read']){
    const {tracker,writes}=setup();const errors=[];
    globalThis.ui={notifications:{error:m=>errors.push(m),info(){}}};
    globalThis.Dialog={async prompt(options){
      const file=kind==='cancel'?undefined:{async text(){if(kind==='read')throw Error('read failed');return kind==='json'?'oops':JSON.stringify(event);}};
      return options.callback([{querySelector(){return {files:file?[file]:[]};}}]);
    }};
    const result=await ChaseImportExport.promptImport(tracker);
    assert.equal(result.length,kind==='valid'?1:0);assert.equal(writes.length,kind==='valid'?1:0);
    assert.equal(errors.length,['json','read'].includes(kind)?1:0);
  }
});

test('dialog reports storage failure and rejects players before opening',async()=>{
  const {tracker}=setup({fail:true});const before=structuredClone(tracker.state);let errors=0,opened=0;
  globalThis.ui={notifications:{error(){errors++;},info(){assert.fail('No success notice on failed write');}}};
  globalThis.Dialog={async prompt(){opened++;return {async text(){return JSON.stringify(event);}};}};
  assert.deepEqual(await ChaseImportExport.promptImport(tracker),[]);
  assert.equal(errors,1);assert.deepEqual(tracker.state,before);
  game.user.isGM=false;
  await assert.rejects(ChaseImportExport.promptImport(tracker),/not allowed/);
  assert.equal(opened,1);
});
