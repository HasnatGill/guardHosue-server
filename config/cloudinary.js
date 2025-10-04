const cloudinary = require("cloudinary").v2;

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env
cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET })

const deleteFileFromCloudinary = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        if (result.result === 'ok') {
            console.log('File deleted successfully');
        } else {
            console.log('File not found or already deleted');
        }
        return result;
    } catch (error) {
        console.error('Error deleting file:', error);
        return error;
    }
}

module.exports = { cloudinary, deleteFileFromCloudinary }