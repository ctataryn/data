
var Relationship = function(hasManyRecord, manyType, store, belongsToName, manyName) {

  this.members = new Ember.OrderedSet();
  this.store = store;
  this.manyName = manyName;
  this.belongsToName = belongsToName;
  this.hasManyRecord = hasManyRecord;
  this.originalRecord = hasManyRecord;
  this.originalKey = manyName;
};

Relationship.prototype = {
  constructor: Relationship,

  computeChanges: function(records) {
    // returns { added: [], removed: [] }
    var added = new Ember.OrderedSet(),
        removed = new Ember.OrderedSet(),
        members = this.members;

    records = setForArray(records);

    records.forEach(function(record) {
      if (members.has(record)) return;
      members.add(record);
      added.add(record);
    });

    members.forEach(function(member) {
      if (records.has(member)) return;
      members.remove(member);
      removed.add(member);
    });

    return { added: added, removed: removed };
  },

  unloadedMembers: function() {
    var unloaded = [];

    this.members.forEach(function(member) {
      if (!member.get('isLoaded')) {
        unloaded.push(member);
      }
    });

    return unloaded;
  },

  removeRecords: function(records){
    var that = this;
    records.forEach(function(record){
      that.removeRecord(record);
    });
  },

  addRecords: function(records){
    var that = this;
    records.forEach(function(record){
      that.addRecord(record);
    });
  },

  getOtherSideFor: function(record){
    return null;
  },

  removeAllRecords: function(){
    //TODO(Igor) this is temp, make sure it works for hasmany
    if (this.inverseRecord){
      this.removeRecord(this.inverseRecord);
    }
  }
};

var OneToMany = function(hasManyRecord, manyType, store, belongsToName, manyName) {
  Relationship.apply(this, arguments);
  this.manyType = manyType;
  this.manyArray = store.recordArrayManager.createManyArray(manyType, Ember.A());
  this.manyArray.relationship = this;
};

OneToMany.prototype = Object.create(Relationship.prototype);

OneToMany.prototype.constructor = OneToMany;
OneToMany.prototype.addRecord = function(record) {
  //TODO(Igor) Consider making the many array just a proxy over the members set
  this.members.add(record);
  this.hasManyRecord.notifyHasManyAdded(this.manyName, record);
  record.notifyBelongsToAdded(this.belongsToName, this);
};

OneToMany.prototype.removeRecord = function(record) {
  this.members.remove(record);
  this.hasManyRecord.notifyHasManyRemoved(this.manyName, record);
  record.notifyBelongsToRemoved(this.belongsToName, this);
};

OneToMany.prototype.getOtherSideFor = function(record) {
  return this.hasManyRecord;
};

var OneToOne = function(record, manyType, store, inverseKey, originalKey) {
  Relationship.apply(this, arguments);
  this.members.add(record);
  this.originalRecord = record;
  this.originalKey = originalKey;
  this.inverseKey = inverseKey;
  this.inverseRecord = null;
};

OneToOne.prototype = Object.create(Relationship.prototype);


//TODO(Igor), rewrite with a members set, size == 2 instead of
//hardcoded, might be better, but careful with keys

//We need to pass in the existingRecord in case the relationship
//is already populated with two records so we can figure out which one
//to remove
OneToOne.prototype.addRecord = function(newRecord, existingRecord) {
  if (this.members.has(newRecord)){ return;}

  //We are full so we will have to remove a record to keep the invariant
  if(this.originalRecord && this.inverseRecord){
    //we are keeping the original and removing the inverse
    if (existingRecord === this.originalRecord){
      this.members.remove(this.inverseRecord);
      this.inverseRecord.notifyBelongsToRemoved(this.inverseKey);
      this.inverseRecord = newRecord;
    } else{
      this.members.remove(this.originalRecord);
      this.originalRecord.notifyBelongsToRemoved(this.originalKey);
      this.originalRecord = newRecord;
    }
  } else if (this.originalRecord){
    this.inverseRecord = newRecord;
  //I dont think the following case can happen due to remove nuking everything
  } else {
    this.originalRecord = newRecord;
  }
  this.members.add(newRecord);
  this.inverseRecord.notifyBelongsToAdded(this.inverseKey, this);
  this.originalRecord.notifyBelongsToAdded(this.originalKey, this);
};

OneToOne.prototype.removeRecord = function(record) {
  this.members.remove(record);
  this.originalRecord.notifyBelongsToRemoved(this.originalKey);
  if (this.inverseRecord){
    this.inverseRecord.notifyBelongsToRemoved(this.inverseKey);
  }
  if (this.inverseRecord === record){
    this.inverseRecord = null;
  } else if (this.originalRecord === record){
    this.originalRecord = null;
  }
};

OneToOne.prototype.getOtherSideFor = function(record) {
  if (record === this.originalRecord){
    return this.inverseRecord;
  }
  else {
    return this.originalRecord;
  }
};

var OneToNone = function() {
  Relationship.apply(this, arguments);
};

OneToNone.prototype = Object.create(Relationship.prototype);
OneToNone.constructor = OneToNone;
OneToNone.prototype.removeRecord = function(record){
  this.inverseRecord = null;
  this.originalRecord.notifyBelongsToRemoved(this.originalKey);
};

OneToNone.prototype.addRecord = function(record){
  this.inverseRecord = record;
  this.originalRecord.notifyBelongsToAdded(this.originalKey, this);
};


var ManyToNone = function(hasManyRecord, manyType, store, belongsToName, manyName) {
  Relationship.apply(this, arguments);
  this.manyType = manyType;
  this.manyArray = store.recordArrayManager.createManyArray(manyType, Ember.A());
  this.manyArray.relationship = this;
};

ManyToNone.prototype = Object.create(Relationship.prototype);
ManyToNone.constructor = ManyToNone;

ManyToNone.prototype.addRecord = function(record) {
  //TODO(Igor) Consider making the many array just a proxy over the members set
  this.members.add(record);
  this.hasManyRecord.notifyHasManyAdded(this.manyName, record);
};

ManyToNone.prototype.removeRecord = function(record) {
  this.members.remove(record);
  this.hasManyRecord.notifyHasManyRemoved(this.manyName, record);
};

function setForArray(array) {
  var set = new Ember.OrderedSet();

  if (array) {
    for (var i=0, l=array.length; i<l; i++) {
      set.add(array[i]);
    }
  }

  return set;
}

var createRelationshipFor = function(record, knownSide, store){
  var inverseKey, inverseKind;
  var recordType = record.constructor;
  var knownKey = knownSide.key;
  var inverse = recordType.inverseFor(knownKey);

  if (!inverse){
    if (knownSide.kind === 'belongsTo'){
      return new OneToNone(record, recordType, store, null, knownSide.key);
    } else {
      return new ManyToNone(record, recordType, store, null, knownSide.key);
    }
  }

  if (knownSide.kind === 'hasMany'){
    if (inverse.kind === 'belongsTo'){
      return new OneToMany(record, recordType, store, inverse.name, knownSide.key);
    } else {
      //return ManyToMany(record, recordType, store, inverse.key, knowSide.key);
      return new OneToMany(record, recordType, store, inverse.name, knownSide.key);
    }
  }
  else {
    if (inverse.kind === 'belongsTo'){
      return new OneToOne(record, recordType, store, inverse.name, knownSide.key);
    }
    else {
      //TODO(Igor) think abot, maybe will be set on many side, maybe not
      return null;
    }
  }
};


export {
  Relationship,
  OneToMany,
  OneToOne,
  OneToNone,
  ManyToNone,
  createRelationshipFor
};
