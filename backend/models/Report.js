import mongoose from 'mongoose';

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
    resolutionImageUrl: String,
    detection: { label: String, confidence: Number, detected: Boolean, boxes: Array, warning: String },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: String,
    status: { type: String, enum: ['Pending', 'In Progress', 'Repaired'], default: 'Pending' },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    notes: String,
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, maxlength: 2000, trim: true },
    ratedAt: Date,
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

export default mongoose.model('Report', reportSchema);
