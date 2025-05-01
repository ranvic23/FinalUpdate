"use client";

import { useState, useEffect } from 'react';
import { db, storage } from '../../firebase-config';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import ProtectedRoute from '@/app/components/protectedroute';

interface Announcement {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'inactive';
  targetAudience: 'all' | 'specific';
  publishDate: string;
  expiryDate: string;
  createdAt: string;
  updatedAt: string;
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState<Omit<Announcement, 'id'>>({
    title: '',
    content: '',
    imageUrl: '',
    priority: 'medium',
    status: 'inactive',
    targetAudience: 'all',
    publishDate: '',
    expiryDate: '',
    createdAt: '',
    updatedAt: ''
  });
  const [currentAnnouncementId, setCurrentAnnouncementId] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const announcementsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Announcement[];
      setAnnouncements(announcementsData);
    } catch (error) {
      console.error('Error fetching announcements:', error);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImage(e.target.files[0]);
    }
  };

  const handleAddAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = '';
      if (selectedImage) {
        const storageRef = ref(storage, `announcements/${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        imageUrl = await getDownloadURL(storageRef);
      }

      const now = new Date().toISOString();
      await addDoc(collection(db, 'announcements'), {
        ...newAnnouncement,
        imageUrl,
        createdAt: now,
        updatedAt: now
      });

      setIsAddModalOpen(false);
      resetForm();
      fetchAnnouncements();
    } catch (error) {
      console.error('Error adding announcement:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = newAnnouncement.imageUrl; // Keep existing image URL if no new image is uploaded
      if (selectedImage) {
        const storageRef = ref(storage, `announcements/${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        imageUrl = await getDownloadURL(storageRef);
      }

      const now = new Date().toISOString();
      await updateDoc(doc(db, 'announcements', currentAnnouncementId!), {
        ...newAnnouncement,
        imageUrl,
        updatedAt: now
      });

      setIsEditModalOpen(false);
      resetForm();
      fetchAnnouncements();
    } catch (error) {
      console.error('Error updating announcement:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string, imageUrl?: string) => {
    if (window.confirm('Are you sure you want to delete this announcement?')) {
      try {
        if (imageUrl) {
          const imageRef = ref(storage, imageUrl);
          await deleteObject(imageRef);
        }
        await deleteDoc(doc(db, 'announcements', announcementId));
        fetchAnnouncements();
      } catch (error) {
        console.error('Error deleting announcement:', error);
      }
    }
  };

  const handleUpdateStatus = async (announcementId: string, newStatus: 'active' | 'inactive') => {
    try {
      await updateDoc(doc(db, 'announcements', announcementId), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      fetchAnnouncements();
    } catch (error) {
      console.error('Error updating announcement status:', error);
    }
  };

  const resetForm = () => {
    setNewAnnouncement({
      title: '',
      content: '',
      imageUrl: '',
      priority: 'medium',
      status: 'inactive',
      targetAudience: 'all',
      publishDate: '',
      expiryDate: '',
      createdAt: '',
      updatedAt: ''
    });
    setSelectedImage(null);
    setCurrentAnnouncementId(null);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const openEditModal = (announcement: Announcement) => {
    setNewAnnouncement({
      title: announcement.title,
      content: announcement.content,
      imageUrl: announcement.imageUrl,
      priority: announcement.priority,
      status: announcement.status,
      targetAudience: announcement.targetAudience,
      publishDate: announcement.publishDate,
      expiryDate: announcement.expiryDate,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt
    });
    setCurrentAnnouncementId(announcement.id);
    setIsEditModalOpen(true);
  };

  return (
    <ProtectedRoute requiredPermissions={['manage_announcements']}>
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Announcements Management</h1>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-bg-light-brown text-white px-4 py-2 rounded hover:bg-opacity-90 transition duration-200"
          >
            Create Announcement
          </button>
        </div>

        {/* Announcements List */}
        <div className="grid grid-cols-1 gap-6">
          {announcements.map((announcement) => (
            <div key={announcement.id} className="border rounded-lg p-6 shadow-md bg-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold text-gray-800">{announcement.title}</h3>
                  <div className="flex gap-2 mt-2">
                    <span className={`px-2 py-1 rounded text-sm ${getPriorityColor(announcement.priority)}`}>
                      {announcement.priority}
                    </span>
                    <span className={`px-2 py-1 rounded text-sm ${
                      announcement.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {announcement.status}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(announcement)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(announcement.id, announcement.status === 'active' ? 'inactive' : 'active')}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Toggle Status
                  </button>
                  <button
                    onClick={() => handleDeleteAnnouncement(announcement.id, announcement.imageUrl)}
                    className="text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              {announcement.imageUrl && (
                <img
                  src={announcement.imageUrl}
                  alt={announcement.title}
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
              )}
              
              <p className="text-gray-600 mb-4">{announcement.content}</p>
              
              <div className="flex justify-between text-sm text-gray-500">
                <span>Published: {new Date(announcement.publishDate).toLocaleDateString()}</span>
                <span>Expires: {new Date(announcement.expiryDate).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Add Announcement Modal */}
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Create New Announcement</h2>
              <form onSubmit={handleAddAnnouncement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Title</label>
                  <input
                    type="text"
                    value={newAnnouncement.title}
                    onChange={(e) => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Content</label>
                  <textarea
                    value={newAnnouncement.content}
                    onChange={(e) => setNewAnnouncement({...newAnnouncement, content: e.target.value})}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    rows={4}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Image (Optional)</label>
                  <input
                    type="file"
                    onChange={handleImageChange}
                    accept="image/*"
                    className="mt-1 block w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Priority</label>
                    <select
                      value={newAnnouncement.priority}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, priority: e.target.value as 'high' | 'medium' | 'low'})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Target Audience</label>
                    <select
                      value={newAnnouncement.targetAudience}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, targetAudience: e.target.value as 'all' | 'specific'})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="all">All Users</option>
                      <option value="specific">Specific Users</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Publish Date</label>
                    <input
                      type="date"
                      value={newAnnouncement.publishDate}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, publishDate: e.target.value})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Expiry Date</label>
                    <input
                      type="date"
                      value={newAnnouncement.expiryDate}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, expiryDate: e.target.value})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false);
                      resetForm();
                    }}
                    className="px-4 py-2 border rounded-md hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-bg-light-brown text-white rounded-md hover:bg-opacity-90 transition duration-200 disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : 'Create Announcement'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Announcement Modal */}
        {isEditModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Edit Announcement</h2>
              <form onSubmit={handleEditAnnouncement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Title</label>
                  <input
                    type="text"
                    value={newAnnouncement.title}
                    onChange={(e) => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Content</label>
                  <textarea
                    value={newAnnouncement.content}
                    onChange={(e) => setNewAnnouncement({...newAnnouncement, content: e.target.value})}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    rows={4}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Image (Optional)</label>
                  <input
                    type="file"
                    onChange={handleImageChange}
                    accept="image/*"
                    className="mt-1 block w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Priority</label>
                    <select
                      value={newAnnouncement.priority}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, priority: e.target.value as 'high' | 'medium' | 'low'})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Target Audience</label>
                    <select
                      value={newAnnouncement.targetAudience}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, targetAudience: e.target.value as 'all' | 'specific'})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="all">All Users</option>
                      <option value="specific">Specific Users</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Publish Date</label>
                    <input
                      type="date"
                      value={newAnnouncement.publishDate}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, publishDate: e.target.value})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Expiry Date</label>
                    <input
                      type="date"
                      value={newAnnouncement.expiryDate}
                      onChange={(e) => setNewAnnouncement({...newAnnouncement, expiryDate: e.target.value})}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditModalOpen(false);
                      resetForm();
                    }}
                    className="px-4 py-2 border rounded-md hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-bg-light-brown text-white rounded-md hover:bg-opacity-90 transition duration-200 disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : 'Update Announcement'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
