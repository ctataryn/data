var get = Ember.get;
var set = Ember.set;
var isNone = Ember.isNone;
var Promise = Ember.RSVP.Promise;

import { Model } from 'ember-data/system/model';
import { PromiseObject } from 'ember-data/system/store';
import {
  relationshipFromMeta,
  typeForRelationshipMeta,
  isSyncRelationship
} from 'ember-data/system/relationship-meta';
import { createRelationshipFor} from "ember-data/system/relationships/relationship";


/**
  @module ember-data
*/

function asyncBelongsTo(type, options, meta) {
  return Ember.computed('data', function(key, value) {
    var data = get(this, 'data');
    var store = get(this, 'store');
    var promiseLabel = "DS: Async belongsTo " + this + " : " + key;
    var promise;

    meta.key = key;

    if (arguments.length === 2) {
      Ember.assert("You can only add a '" + type + "' record to this relationship", !value || value instanceof typeForRelationshipMeta(store, meta));
      return value === undefined ? null : PromiseObject.create({
        promise: Promise.cast(value, promiseLabel)
      });
    }

    var link = data.links && data.links[key];
    var belongsTo = data[key];

    if (!isNone(belongsTo)) {
      var inverse = this.constructor.inverseFor(key);
      //but for now only in the oneToOne case
      if (inverse && inverse.kind === 'belongsTo'){
        set(belongsTo, inverse.name, this);
      }
      //TODO(Igor) after OR doesn't seem that will be called
      promise = store.findById(belongsTo.constructor, belongsTo.get('id')) || Promise.cast(belongsTo, promiseLabel);
      return PromiseObject.create({
        promise: promise
      });
    } else if (link) {
      promise = store.findBelongsTo(this, link, relationshipFromMeta(store, meta));
      return PromiseObject.create({
        promise: promise
      });
    } else {
      return null;
    }
  }).meta(meta);
}

/**
  `DS.belongsTo` is used to define One-To-One and One-To-Many
  relationships on a [DS.Model](/api/data/classes/DS.Model.html).


  `DS.belongsTo` takes an optional hash as a second parameter, currently
  supported options are:

  - `async`: A boolean value used to explicitly declare this to be an async relationship.
  - `inverse`: A string used to identify the inverse property on a
    related model in a One-To-Many relationship. See [Explicit Inverses](#toc_explicit-inverses)

  #### One-To-One
  To declare a one-to-one relationship between two models, use
  `DS.belongsTo`:

  ```javascript
  App.User = DS.Model.extend({
    profile: DS.belongsTo('profile')
  });

  App.Profile = DS.Model.extend({
    user: DS.belongsTo('user')
  });
  ```

  #### One-To-Many
  To declare a one-to-many relationship between two models, use
  `DS.belongsTo` in combination with `DS.hasMany`, like this:

  ```javascript
  App.Post = DS.Model.extend({
    comments: DS.hasMany('comment')
  });

  App.Comment = DS.Model.extend({
    post: DS.belongsTo('post')
  });
  ```

  @namespace
  @method belongsTo
  @for DS
  @param {String or DS.Model} type the model type of the relationship
  @param {Object} options a hash of options
  @return {Ember.computed} relationship
*/
function belongsTo(type, options) {
  if (typeof type === 'object') {
    options = type;
    type = undefined;
  } else {
    Ember.assert("The first argument to DS.belongsTo must be a string representing a model type key, e.g. use DS.belongsTo('person') to define a relation to the App.Person model", !!type && (typeof type === 'string' || Model.detect(type)));
  }

  options = options || {};

  var meta = {
    type: type,
    isRelationship: true,
    options: options,
    kind: 'belongsTo',
    key: null
  };

  /*
  if (options.async) {
    return asyncBelongsTo(type, options, meta);
  }
  */

  return Ember.computed(function(key, value) {
    var store = get(this, 'store');
    var data = get(this, 'data');

    if (arguments.length>1) {
      Ember.assert("You can only add a '" + type + "' record to this relationship", !value || value instanceof typeForRelationshipMeta(store, meta));
      if(this._relationships[key]){
        this._relationships[key].removeRecord(this);
      }

      if (value){
        this._relationships[key] = createRelationshipFor(this, meta, this.store);

        var inverse = this.inverseFor(key);

        if(inverse){
          if(value._relationships[inverse.name]){
            this._relationships[key] = value._relationships[inverse.name];
          }
          else{
            //In this case the other record isn't on the relationship so we need to add it
            value._relationships[inverse.name] = this._relationships[key];
            this._relationships[key].addRecord(value, this);
          }
        }

        this._relationships[key].addRecord(this, value);
      }

      return value;
    }

    var link = data.links && data.links[key];
    if (this._relationships[key] && this._relationships[key].hasOtherSideFor(this)) {
      return this._relationships[key].getOtherSideFor(this, options.async);
    } else if (link) {
      return store.findBelongsTo(this, link, relationshipFromMeta(store, meta));
    }

    //Promise null
    return null;

  }).meta(meta);
}

/**
  These observers observe all `belongsTo` relationships on the record. See
  `relationships/ext` to see how these observers get their dependencies.

  @class Model
  @namespace DS
*/
Model.reopen({
  notifyBelongsToAdded: function(key, relationship) {
    this._relationships[key] = relationship;
    this.notifyPropertyChange(key);
  },

  notifyBelongsToRemoved: function(key) {
    this._relationships[key] = null;
    this.notifyPropertyChange(key);
  }
});

export default belongsTo;
