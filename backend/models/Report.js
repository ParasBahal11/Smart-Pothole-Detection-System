import mongoose from 'mongoose';
import { timelineFor } from '../utils/reportInsights.js';

const channelSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['queued', 'sent', 'acknowledged', 'in_progress', 'resolved', 'no_response'],
      default: 'queued',
    },
    sentAt: Date,
    acknowledgedAt: Date,
    updatedAt: Date,
    note: String,
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    imageUrl: { type: String, required: true },
    imageName: String,
    detection: { label: String, confidence: Number, detected: Boolean, boxes: Array, warning: String },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: String,
    status: { type: String, enum: ['Pending', 'In Progress', 'Repaired'], default: 'Pending' },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    severityScore: { type: Number, min: 0, max: 100 },
    trackingId: { type: String, unique: true, sparse: true, index: true },
    // Citizens who confirmed the same pothole instead of filing a duplicate complaint
    supporters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    timeline: [
      {
        type: { type: String },
        title: String,
        detail: String,
        by: String,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    notes: String,
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, maxlength: 2000, trim: true },
    ratedAt: Date,
    workImages: [String],
    workNote: { type: String, trim: true, maxlength: 1000 },
    completedAt: Date,
    notified: [String],
    complaintRouting: {
      dispatched: { type: Boolean, default: false },
      dispatchedAt: Date,
      primary: { type: String, enum: ['government', 'contractor'] },
      government: { type: channelSchema, default: () => ({}) },
      contractor: { type: channelSchema, default: () => ({}) },
      escalations: [
        {
          from: String,
          to: String,
          at: Date,
          reason: String,
        },
      ],
    },
  },
  { timestamps: true }
);

reportSchema.index({ latitude: 1, longitude: 1 });

// API output: always include a timeline (derived for older complaints) and the support count,
// without exposing the ids of the citizens who confirmed the pothole.
reportSchema.set('toJSON', {
  transform(doc, ret) {
    ret.supportCount = (ret.supporters || []).length;
    delete ret.supporters;
    ret.timeline = timelineFor(ret);
    return ret;
  },
});

export default mongoose.model('Report', reportSchema);
