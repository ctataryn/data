import { PromiseArray, PromiseObject } from "ember-data/system/promise_proxies";

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
  hasFetchedLink: false,

  //TODO(Igor) implement
  destroy: function(){
  },

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

  addRecords: function(records, idx){
    var that = this;
    records.forEach(function(record){
      that.addRecord(record, idx);
      if (idx !== undefined) {
        idx++;
      }
    });
  },

  getOtherSideFor: function(record, isAsync){
    return this.getRecord(this.currentOtherSideFor(record), isAsync);
  },

  removeAllRecords: function(){
    //TODO(Igor) this is temp, make sure it works for hasmany
    if (this.inverseRecord){
      this.removeRecord(this.inverseRecord);
    }
  },

  currentOtherSideFor: function(record) {
    return undefined;
  },

  hasOtherSideFor: function(record){
    return !!this.currentOtherSideFor(record);
  },

  getRecord: function(record, isAsync) {
    if (isAsync) {
      var promise;
      if (record) {
        promise = this.store._findByRecord(record);
      } else {
        promise = Ember.RSVP.resolve(null);
      }

      return PromiseObject.create({
        promise: promise
      });
    } else {
      //TODO(Igor) assert that we actually have it
      return record;
    }
  },

  getManyArray: function(isAsync) {
    if (isAsync) {
      var self = this;
      var promise;
      if (this.hasManyLink && !this.hasFetchedLink){
        promise = this.store.findHasMany(this.hasManyRecord, this.hasManyLink, this.belongsToType).then(function(records){
          self.updateRecordsFromServer(records);
          self.hasFetchedLink = true;
          //TODO(Igor) try to abstract the isLoaded part
          self.manyArray.set('isLoaded', true);
          return self.manyArray;
        });
      } else {
        var manyArray = this.manyArray;
        promise = this.store.findMany(manyArray.toArray()).then(function(){
          self.manyArray.set('isLoaded', true);
          return manyArray;
        });
      }
      return PromiseArray.create({
        promise: promise
      });
    } else {
      this.manyArray.set('isLoaded', true);
      return this.manyArray;
   }
  },

  updateRecordsFromServer: function(records) {
    //TODO Keep the newlyCreated records
    //TODO(Igor) Think about the ordering
    var delta = this.computeChanges(records);
    this.addRecords(delta.added);
    this.removeRecords(delta.removed);
  },

  //for hasMany only
  updateData: function(data, key){
    if (data.links && data.links[key]) {
      var link = data.links[key];
      if (link !== this.hasManyLink) {
        this.hasManyLink = data.links[key];
        this.hasFetchedLink = false;
        //Need to clear out the whole manyArray becase the link changed
        this.hasManyRecord.notifyPropertyChange(key);
      }
    }
    if (data[key]){
      this.updateRecordsFromServer(data[key]);
    }
  }
};

var OneToMany = function(hasManyRecord, manyType, store, belongsToName, manyName, belongsToType, options) {
  Relationship.apply(this, arguments);
  this.belongsToType = belongsToType;
  this.manyType = manyType;
  this.manyArray = store.recordArrayManager.createManyArray(belongsToType, Ember.A());
  this.manyArray.relationship = this;
  this.isPolymorphic = options.polymorphic;
  this.manyArray.isPolymorphic = this.isPolymorphic;
};

OneToMany.prototype = Object.create(Relationship.prototype);

OneToMany.prototype.constructor = OneToMany;
OneToMany.prototype.addRecord = function(record, idx) {
      Ember.assert("You cannot add '" + record.constructor.typeKey + "' records to this relationship (only '" + this.belongsToType.typeKey + "' allowed)", !this.belongsToType || record instanceof this.belongsToType);

  //TODO(Igor) Consider making the many array just a proxy over the members set
  this.members.add(record);
  this.hasManyRecord.notifyHasManyAdded(this.manyName, record, idx);
  record.notifyBelongsToAdded(this.belongsToName, this);
};

OneToMany.prototype.removeRecord = function(record) {
  this.members.remove(record);
  this.hasManyRecord.notifyHasManyRemoved(this.manyName, record);
  record.notifyBelongsToRemoved(this.belongsToName, this);
};

OneToMany.prototype.destroy = function() {
  this.manyArray.destroy();
};

OneToMany.prototype.currentOtherSideFor = function(record) {
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

OneToOne.prototype.currentOtherSideFor = function(record) {
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


var ManyToNone = function(hasManyRecord, manyType, store, belongsToName, manyName, belongsToType, options) {
  Relationship.apply(this, arguments);
  this.manyType = manyType;
  this.belongsToType = belongsToType;
  this.isPolymorphic = options.polymorphic;
  this.manyArray = store.recordArrayManager.createManyArray(manyType, Ember.A());
  this.manyArray.relationship = this;
  //TODO(Igor) refactor the creation
  this.manyArray.isPolymorphic = this.isPolymorphic;
};

ManyToNone.prototype = Object.create(Relationship.prototype);
ManyToNone.constructor = ManyToNone;

ManyToNone.prototype.addRecord = function(record, idx) {
  //TODO(Igor) Consider making the many array just a proxy over the members set
  this.members.add(record);
  this.hasManyRecord.notifyHasManyAdded(this.manyName, record, idx);
};

ManyToNone.prototype.removeRecord = function(record) {
  this.members.remove(record);
  this.hasManyRecord.notifyHasManyRemoved(this.manyName, record);
};

ManyToNone.prototype.destroy = function() {
  this.manyArray.destroy();
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
  var options = knownSide.options;

  if (!inverse){
    if (knownSide.kind === 'belongsTo'){
      return new OneToNone(record, recordType, store, null, knownSide.key);
    } else {
      return new ManyToNone(record, recordType, store, null, knownSide.key, knownSide.type, options);
    }
  }

  if (knownSide.kind === 'hasMany'){
    if (inverse.kind === 'belongsTo'){
      return new OneToMany(record, recordType, store, inverse.name, knownSide.key, knownSide.type, options);
    } else {
      //return ManyToMany(record, recordType, store, inverse.key, knowSide.key);
      return new OneToMany(record, recordType, store, inverse.name, knownSide.key, knownSide.type, options);
    }
  }
  else {
    if (inverse.kind === 'belongsTo'){
      return new OneToOne(record, recordType, store, inverse.name, knownSide.key);
    }
    else {
      //return new OneToMany(record, recordType, store, inverse.name, knownSide.key);
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
