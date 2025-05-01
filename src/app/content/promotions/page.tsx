"use client";

import { useState, useEffect } from 'react';
import { db, storage } from '../../firebase-config';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import ProtectedRoute from '@/app/components/protectedroute';

interface Promotion {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  discountPercentage?: number;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newPromotion, setNewPromotion] = useState<Omit<Promotion, 'id'>>({
    title: '',
    description: '',
    imageUrl: '',
    startDate: '',
    endDate: '',
    status: 'inactive',
    discountPercentage: 0
  });
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPromotionId, setCurrentPromotionId] = useState<string | null>(null);

  // Fetch promotions from Firebase
  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'promotions'));
      const promotionsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Promotion[];
      setPromotions(promotionsData);
    } catch (error) {
      console.error('Error fetching promotions:', error);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImage(e.target.files[0]);
    }
  };

  const handleAddPromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = '';
      if (selectedImage) {
        const storageRef = ref(storage, `promotions/${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        imageUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, 'promotions'), {
        ...newPromotion,
        imageUrl,
        createdAt: new Date().toISOString()
      });

      setIsAddModalOpen(false);
      resetForm();
      fetchPromotions();
    } catch (error) {
      console.error('Error adding promotion:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditPromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = newPromotion.imageUrl; // Keep existing image URL if no new image is uploaded
      if (selectedImage) {
        const storageRef = ref(storage, `promotions/${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        imageUrl = await getDownloadURL(storageRef);
      }

      await updateDoc(doc(db, 'promotions', currentPromotionId!), {
        ...newPromotion,
        imageUrl,
        updatedAt: new Date().toISOString()
      });

      setIsEditModalOpen(false);
      resetForm();
      fetchPromotions();
    } catch (error) {
      console.error('Error updating promotion:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePromotion = async (promotionId: string, imageUrl: string) => {
    if (window.confirm('Are you sure you want to delete this promotion?')) {
      try {
        // Delete image from storage if it exists
        if (imageUrl) {
          const imageRef = ref(storage, imageUrl);
          await deleteObject(imageRef);
        }

        // Delete promotion document from Firestore
        await deleteDoc(doc(db, 'promotions', promotionId));
        fetchPromotions();
      } catch (error) {
        console.error('Error deleting promotion:', error);
      }
    }
  };

  const handleUpdateStatus = async (promotionId: string, newStatus: 'active' | 'inactive') => {
    try {
      await updateDoc(doc(db, 'promotions', promotionId), {
        status: newStatus
      });
      fetchPromotions();
    } catch (error) {
      console.error('Error updating promotion status:', error);
    }
  };

  const resetForm = () => {
    setNewPromotion({
      title: '',
      description: '',
      imageUrl: '',
      startDate: '',
      endDate: '',
      status: 'inactive',
      discountPercentage: 0
    });
    setSelectedImage(null);
    setCurrentPromotionId(null);
  };

  const openEditModal = (promotion: Promotion) => {
    setNewPromotion({
      title: promotion.title,
      description: promotion.description,
      imageUrl: promotion.imageUrl,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      status: promotion.status,
      discountPercentage: promotion.discountPercentage || 0
    });
    setCurrentPromotionId(promotion.id);
    setIsEditModalOpen(true);
  };

  return (
    <ProtectedRoute requiredPermissions={['manage_promotions']}>
      <div className="flex h-screen overflow-hidden">
          {/* Sidebar will be rendered by the layout */}
          <div className="flex-1 overflow-y-auto">
              <div className="p-6">
                  {/* Header */}
                  <div className="flex justify-between items-center mb-6">
                      <h1 className="text-3xl font-bold text-gray-800">Promotions Management</h1>
                      <button
                          onClick={() => setIsAddModalOpen(true)}
                          className="px-4 py-2 bg-bg-light-brown text-white rounded-md hover:bg-opacity-90 transition duration-200"
                      >
                          Add New Promotion
                      </button>
                  </div>

                  {/* Promotions Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {promotions.map((promotion) => (
                          <div key={promotion.id} className="border rounded-lg p-4 shadow-md bg-white">
                              {promotion.imageUrl && (
                                  <img
                                      src={promotion.imageUrl}
                                      alt={promotion.title}
                                      className="w-full h-48 object-cover rounded-lg mb-4"
                                  />
                              )}
                              <h3 className="text-lg font-semibold text-gray-800">{promotion.title}</h3>
                              <p className="text-gray-600 mb-2">{promotion.description}</p>
                              <div className="flex justify-between items-center mt-4">
                                  <span className={`px-2 py-1 rounded ${
                                      promotion.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                      {promotion.status}
                                  </span>
                                  <div className="space-x-2">
                                      <button
                                          onClick={() => openEditModal(promotion)}
                                          className="text-blue-600 hover:text-blue-800 transition duration-200"
                                      >
                                          Edit
                                      </button>
                                      <button
                                          onClick={() => handleUpdateStatus(promotion.id, promotion.status === 'active' ? 'inactive' : 'active')}
                                          className="text-blue-600 hover:text-blue-800 transition duration-200"
                                      >
                                          Toggle Status
                                      </button>
                                      <button
                                          onClick={() => handleDeletePromotion(promotion.id, promotion.imageUrl)}
                                          className="text-red-600 hover:text-red-800 transition duration-200"
                                      >
                                          Delete
                                      </button>
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>

                  {/* Modals */}
                  {isAddModalOpen && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                          <div className="bg-white p-6 rounded-lg w-full max-w-md">
                              <h2 className="text-xl font-bold mb-4">Add New Promotion</h2>
                              <form onSubmit={handleAddPromotion}>
                                  <div className="space-y-4">
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Title</label>
                                          <input
                                              type="text"
                                              value={newPromotion.title}
                                              onChange={(e) => setNewPromotion({...newPromotion, title: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Description</label>
                                          <textarea
                                              value={newPromotion.description}
                                              onChange={(e) => setNewPromotion({...newPromotion, description: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Promotion Image</label>
                                          <input
                                              type="file"
                                              onChange={handleImageChange}
                                              accept="image/*"
                                              className="mt-1 block w-full"
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Start Date</label>
                                          <input
                                              type="date"
                                              value={newPromotion.startDate}
                                              onChange={(e) => setNewPromotion({...newPromotion, startDate: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">End Date</label>
                                          <input
                                              type="date"
                                              value={newPromotion.endDate}
                                              onChange={(e) => setNewPromotion({...newPromotion, endDate: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Discount Percentage</label>
                                          <input
                                              type="number"
                                              value={newPromotion.discountPercentage}
                                              onChange={(e) => setNewPromotion({...newPromotion, discountPercentage: Number(e.target.value)})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              min="0"
                                              max="100"
                                          />
                                      </div>
                                  </div>
                                  <div className="mt-6 flex justify-end space-x-3">
                                      <button
                                          type="button"
                                          onClick={() => setIsAddModalOpen(false)}
                                          className="px-4 py-2 border rounded-md hover:bg-gray-100"
                                      >
                                          Cancel
                                      </button>
                                      <button
                                          type="submit"
                                          disabled={loading}
                                          className="px-4 py-2 bg-bg-light-brown text-white rounded-md hover:bg-opacity-90 transition duration-200 disabled:opacity-50"
                                      >
                                          {loading ? 'Adding...' : 'Add Promotion'}
                                      </button>
                                  </div>
                              </form>
                          </div>
                      </div>
                  )}

                  {isEditModalOpen && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                          <div className="bg-white p-6 rounded-lg w-full max-w-md">
                              <h2 className="text-xl font-bold mb-4">Edit Promotion</h2>
                              <form onSubmit={handleEditPromotion}>
                                  <div className="space-y-4">
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Title</label>
                                          <input
                                              type="text"
                                              value={newPromotion.title}
                                              onChange={(e) => setNewPromotion({...newPromotion, title: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Description</label>
                                          <textarea
                                              value={newPromotion.description}
                                              onChange={(e) => setNewPromotion({...newPromotion, description: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Promotion Image</label>
                                          <input
                                              type="file"
                                              onChange={handleImageChange}
                                              accept="image/*"
                                              className="mt-1 block w-full"
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Start Date</label>
                                          <input
                                              type="date"
                                              value={newPromotion.startDate}
                                              onChange={(e) => setNewPromotion({...newPromotion, startDate: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">End Date</label>
                                          <input
                                              type="date"
                                              value={newPromotion.endDate}
                                              onChange={(e) => setNewPromotion({...newPromotion, endDate: e.target.value})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              required
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-sm font-medium text-gray-700">Discount Percentage</label>
                                          <input
                                              type="number"
                                              value={newPromotion.discountPercentage}
                                              onChange={(e) => setNewPromotion({...newPromotion, discountPercentage: Number(e.target.value)})}
                                              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                              min="0"
                                              max="100"
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
                                          {loading ? 'Updating...' : 'Update Promotion'}
                                      </button>
                                  </div>
                              </form>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>
    </ProtectedRoute>
  );
}
